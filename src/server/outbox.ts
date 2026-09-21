import "server-only";

import { db } from "@/db";
import { type SendJob, mailbox, message, sendJob } from "@/db/schema";
import { env } from "@/lib/env";
import { sendRawEmail } from "@/lib/ses";
import { newId } from "@/lib/utils";
import { and, eq, sql } from "drizzle-orm";
import { type SentContext, markFailed, markSent } from "./sent";

/* -------------------------------------------------------------------------- */
/* Which failures are worth trying again                                      */
/* -------------------------------------------------------------------------- */

/**
 * SES refusing a message and SES being unable to take it right now are not the
 * same thing, and treating them the same is how a queue turns one bad address
 * into a thousand pointless attempts.
 *
 * Anything about the message itself — an unverified identity, a malformed
 * address, a suspended account — is final. Throttling, an outage, and a broken
 * socket are not.
 */
const PERMANENT = new Set([
  "MessageRejected",
  "MailFromDomainNotVerifiedException",
  "AccountSuspendedException",
  "SendingPausedException",
  "BadRequestException",
  "NotFoundException",
  "InvalidParameterValue",
  "ValidationException",
  "AccessDeniedException",
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "SignatureDoesNotMatch",
]);

const RETRYABLE = new Set([
  "Throttling",
  "ThrottlingException",
  "TooManyRequestsException",
  "LimitExceededException",
  "ServiceUnavailable",
  "InternalFailure",
  "InternalServerError",
  "RequestTimeout",
  "RequestTimeoutException",
  "TimeoutError",
  "ConcurrentModificationException",
]);

/** Network-level failures, which arrive as a code rather than an AWS name. */
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
]);

export function isRetryableSendError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const detail = error as {
    name?: string;
    code?: string;
    $retryable?: { throttling?: boolean };
    $metadata?: { httpStatusCode?: number };
  };

  if (detail.name && PERMANENT.has(detail.name)) return false;
  if (detail.name && RETRYABLE.has(detail.name)) return true;
  if (detail.code && RETRYABLE_CODES.has(detail.code)) return true;

  // The SDK marks what it would have retried itself.
  if (detail.$retryable) return true;

  const status = detail.$metadata?.httpStatusCode;
  if (status === 429 || (status !== undefined && status >= 500)) return true;

  // An unrecognised failure with no status at all never reached AWS, which
  // means the message did not go anywhere and trying again is safe.
  return status === undefined && detail.name !== undefined && !PERMANENT.has(detail.name);
}

export function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "SES could not take the message";
}

/* -------------------------------------------------------------------------- */
/* Putting work in                                                            */
/* -------------------------------------------------------------------------- */

/** Tries to spread a burst of retries out rather than firing them together. */
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;
export const DEFAULT_MAX_ATTEMPTS = 8;

export function backoffMs(attempts: number) {
  const flat = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
  // ±20%, so a hundred messages queued by one outage do not all wake at once.
  return Math.round(flat * (0.8 + Math.random() * 0.4));
}

export interface EnqueueInput {
  orgId: string;
  messageId: string;
  mailboxId: string;
  fromAddress: string;
  recipients: string[];
  raw: Uint8Array;
  /** When it may first be attempted. Now, for a send SES just turned away. */
  dueAt?: Date;
  attempts?: number;
  lastError?: string | null;
  maxAttempts?: number;
}

export async function enqueueSend(input: EnqueueInput) {
  const id = newId("job");
  await db
    .insert(sendJob)
    .values({
      id,
      organizationId: input.orgId,
      messageId: input.messageId,
      mailboxId: input.mailboxId,
      fromAddress: input.fromAddress,
      recipients: input.recipients,
      // Base64 rather than the bytes: the column is text, and a MIME body can
      // carry anything once an attachment is in it.
      rawMime: Buffer.from(input.raw).toString("base64"),
      status: "pending",
      attempts: input.attempts ?? 0,
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: input.dueAt ?? new Date(),
      lastError: input.lastError ?? null,
    })
    // One job per message. A second insert means something tried to queue the
    // same send twice, and the first one is the one that counts.
    .onConflictDoNothing({ target: sendJob.messageId });
  return id;
}

/* -------------------------------------------------------------------------- */
/* Taking work out                                                            */
/* -------------------------------------------------------------------------- */

/** A job claimed but never finished. Its worker is gone; someone else may have it. */
const STALE_LOCK_MS = 5 * 60_000;

/**
 * Hands the caller a batch of due jobs and marks them taken, in one statement.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes running two containers safe: each one
 * takes rows the other is not holding, rather than both taking the same row
 * and sending the message twice.
 */
async function claim(limit: number): Promise<SendJob[]> {
  const rows = await db.execute<SendJob>(sql`
    UPDATE "send_job" AS j
       SET "status" = 'sending',
           "locked_at" = now(),
           "updated_at" = now()
     WHERE j."id" IN (
       SELECT "id" FROM "send_job"
        WHERE "status" = 'pending'
          AND "next_attempt_at" <= now()
        ORDER BY "next_attempt_at"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING j."id",
              j."organization_id" AS "organizationId",
              j."message_id" AS "messageId",
              j."mailbox_id" AS "mailboxId",
              j."from_address" AS "fromAddress",
              j."recipients",
              j."raw_mime" AS "rawMime",
              j."status",
              j."attempts",
              j."max_attempts" AS "maxAttempts",
              j."next_attempt_at" AS "nextAttemptAt",
              j."locked_at" AS "lockedAt",
              j."last_error" AS "lastError",
              j."created_at" AS "createdAt",
              j."updated_at" AS "updatedAt"
  `);
  return [...rows] as SendJob[];
}

/**
 * Puts jobs whose worker vanished mid-send back in the queue.
 *
 * This is the one place the queue is at-least-once rather than exactly-once:
 * a process killed between SES accepting a message and the row being written
 * leaves a job that looks unfinished, and retrying it sends the message twice.
 * The window is milliseconds wide, and the alternative — never retrying —
 * loses the message every time a container restarts.
 */
async function releaseStale() {
  await db.execute(sql`
    UPDATE "send_job"
       SET "status" = 'pending',
           "attempts" = "attempts" + 1,
           "locked_at" = NULL,
           -- It was due when it was claimed, and the delay since was a crash
           -- rather than anything SES said. Let it go again straight away.
           "next_attempt_at" = now(),
           "last_error" = 'The worker stopped before this finished',
           "updated_at" = now()
     WHERE "status" = 'sending'
       AND "locked_at" < now() - ${`${STALE_LOCK_MS} milliseconds`}::interval
  `);
}

/** Everything {@link markSent} needs, read back from the message the job points at. */
async function contextFor(job: SendJob): Promise<SentContext | null> {
  const [row] = await db
    .select({ msg: message, address: mailbox.address })
    .from(message)
    .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
    .where(eq(message.id, job.messageId))
    .limit(1);
  if (!row) return null;

  return {
    orgId: job.organizationId,
    messageId: row.msg.id,
    threadId: row.msg.threadId,
    mailboxId: row.msg.mailboxId,
    mailboxAddress: row.address,
    rfcMessageId: row.msg.rfcMessageId,
    to: row.msg.to,
    cc: row.msg.cc,
    subject: row.msg.subject,
    apiKeyId: row.msg.apiKeyId,
    isTest: row.msg.isTest,
  };
}

async function finishJob(job: SendJob, sesMessageId: string) {
  await db
    .update(sendJob)
    .set({ status: "sent", lockedAt: null, lastError: null, updatedAt: new Date() })
    .where(eq(sendJob.id, job.id));

  const context = await contextFor(job);
  if (context) await markSent(context, sesMessageId);
}

async function retryJob(job: SendJob, reason: string) {
  const attempts = job.attempts + 1;

  if (attempts >= job.maxAttempts) {
    await giveUp(job, attempts, reason);
    return "failed" as const;
  }

  await db
    .update(sendJob)
    .set({
      status: "pending",
      attempts,
      lockedAt: null,
      lastError: reason.slice(0, 2000),
      nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
      updatedAt: new Date(),
    })
    .where(eq(sendJob.id, job.id));

  // The row stays queued, but says why it has not moved.
  await db
    .update(message)
    .set({ deliveryError: reason.slice(0, 2000) })
    .where(eq(message.id, job.messageId));

  return "retried" as const;
}

async function giveUp(job: SendJob, attempts: number, reason: string) {
  await db
    .update(sendJob)
    .set({
      status: "failed",
      attempts,
      lockedAt: null,
      lastError: reason.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(eq(sendJob.id, job.id));

  const context = await contextFor(job);
  if (context) await markFailed(context, reason);
}

export interface OutboxRun {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
}

/**
 * One pass over the queue.
 *
 * Jobs are attempted one after another rather than together: SES meters sends
 * per second, and firing a batch at it is the fastest way to be throttled for
 * all of them — which is how they got here in the first place.
 */
export async function runOutboxOnce(limit = 10): Promise<OutboxRun> {
  await releaseStale();

  const jobs = await claim(limit);
  const run: OutboxRun = { claimed: jobs.length, sent: 0, retried: 0, failed: 0 };

  for (const job of jobs) {
    try {
      const result = await sendRawEmail({
        raw: Buffer.from(job.rawMime, "base64"),
        from: job.fromAddress,
        to: job.recipients,
        configurationSet: env.aws.configurationSet,
      });
      await finishJob(job, result.messageId);
      run.sent += 1;
    } catch (error) {
      const reason = describeError(error);
      if (isRetryableSendError(error)) {
        const outcome = await retryJob(job, reason);
        if (outcome === "retried") run.retried += 1;
        else run.failed += 1;
      } else {
        await giveUp(job, job.attempts + 1, reason);
        run.failed += 1;
      }
    }
  }

  return run;
}

/* -------------------------------------------------------------------------- */
/* Cancelling                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Takes a job out of the queue, if it is still there to take.
 *
 * Returns false when the job has already been claimed by a worker, which is
 * the honest answer: at that point the message is on its way to SES and there
 * is nothing left to call off.
 */
export async function cancelJobForMessage(messageId: string) {
  const rows = await db
    .update(sendJob)
    .set({ status: "canceled", lockedAt: null, updatedAt: new Date() })
    .where(and(eq(sendJob.messageId, messageId), eq(sendJob.status, "pending")))
    .returning({ id: sendJob.id });
  return rows.length > 0;
}

/** Moves a pending job's due time. Same rule: only while nothing holds it. */
export async function rescheduleJobForMessage(messageId: string, dueAt: Date) {
  const rows = await db
    .update(sendJob)
    .set({ nextAttemptAt: dueAt, updatedAt: new Date() })
    .where(and(eq(sendJob.messageId, messageId), eq(sendJob.status, "pending")))
    .returning({ id: sendJob.id });
  return rows.length > 0;
}

/* -------------------------------------------------------------------------- */
/* The loop                                                                   */
/* -------------------------------------------------------------------------- */

const TICK_MS = 15_000;

const globalForOutbox = globalThis as unknown as {
  mailroomOutboxTimer?: NodeJS.Timeout;
  mailroomOutboxBusy?: boolean;
};

/**
 * Starts the worker inside the web process.
 *
 * A self-hosted instance is usually one container, and asking whoever runs it
 * to wire up a scheduler as well would mean scheduled mail silently never
 * leaves for anyone who skipped that step. Running more than one container is
 * still fine: the claim is what keeps them apart, not the count.
 *
 * Set OUTBOX_WORKER=false to turn this off and drive the queue from somewhere
 * else instead.
 */
export function startOutboxWorker() {
  if (process.env.OUTBOX_WORKER === "false") return;
  if (globalForOutbox.mailroomOutboxTimer) return;

  const tick = async () => {
    // A slow pass must not have the next one pile up behind it.
    if (globalForOutbox.mailroomOutboxBusy) return;
    globalForOutbox.mailroomOutboxBusy = true;
    try {
      const run = await runOutboxOnce();
      if (run.claimed > 0) {
        console.log(`outbox: ${run.sent} sent, ${run.retried} to retry, ${run.failed} given up on`);
      }
    } catch (error) {
      console.error("outbox pass failed", error);
    } finally {
      globalForOutbox.mailroomOutboxBusy = false;
    }
  };

  const timer = setInterval(tick, TICK_MS);
  // Do not hold the process open for the sake of the queue.
  timer.unref?.();
  globalForOutbox.mailroomOutboxTimer = timer;
}
