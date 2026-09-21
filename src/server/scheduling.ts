import "server-only";

import { db } from "@/db";
import { mailbox, message } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { type ApiCaller, callerMailboxIds } from "./api-auth";
import { cancelJobForMessage, rescheduleJobForMessage } from "./outbox";
import { type SentContext, markCanceled } from "./sent";

/**
 * Changing your mind about a message that has not gone out.
 *
 * Both of these only work while the queue still holds the job. Once a worker
 * has claimed it the message is on its way to SES, and saying otherwise would
 * be a lie a caller would build on.
 */

export type ScheduleChange =
  | { ok: true; message: typeof message.$inferSelect; mailboxAddress: string }
  | { ok: false; status: 404 | 409; reason: string };

async function findWaiting(caller: ApiCaller, id: string) {
  const mailboxIds = await callerMailboxIds(caller);
  if (mailboxIds.length === 0) return null;

  const [row] = await db
    .select({ msg: message, address: mailbox.address })
    .from(message)
    .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
    .where(and(eq(message.id, id), inArray(message.mailboxId, mailboxIds)))
    .limit(1);

  return row ?? null;
}

function contextFrom(
  caller: ApiCaller,
  row: { msg: typeof message.$inferSelect; address: string },
): SentContext {
  return {
    orgId: caller.orgId,
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

/** Calls off a message that is still waiting. */
export async function cancelSend(caller: ApiCaller, id: string): Promise<ScheduleChange> {
  const row = await findWaiting(caller, id);
  if (!row) return { ok: false, status: 404, reason: "No such message" };

  if (row.msg.deliveryStatus !== "queued") {
    return {
      ok: false,
      status: 409,
      reason:
        row.msg.deliveryStatus === "canceled"
          ? "That message was already cancelled"
          : "That message has already been sent",
    };
  }

  const taken = await cancelJobForMessage(row.msg.id);
  if (!taken) {
    return { ok: false, status: 409, reason: "That message is already on its way to SES" };
  }

  await markCanceled(contextFrom(caller, row));

  const [fresh] = await db.select().from(message).where(eq(message.id, row.msg.id));
  return { ok: true, message: fresh ?? row.msg, mailboxAddress: row.address };
}

/** Moves a waiting message to a different time. */
export async function rescheduleSend(
  caller: ApiCaller,
  id: string,
  at: Date,
): Promise<ScheduleChange> {
  const row = await findWaiting(caller, id);
  if (!row) return { ok: false, status: 404, reason: "No such message" };

  if (row.msg.deliveryStatus !== "queued") {
    return { ok: false, status: 409, reason: "That message is no longer waiting to be sent" };
  }

  const moved = await rescheduleJobForMessage(row.msg.id, at);
  if (!moved) {
    return { ok: false, status: 409, reason: "That message is already on its way to SES" };
  }

  await db.update(message).set({ scheduledAt: at }).where(eq(message.id, row.msg.id));

  const [fresh] = await db.select().from(message).where(eq(message.id, row.msg.id));
  return { ok: true, message: fresh ?? row.msg, mailboxAddress: row.address };
}
