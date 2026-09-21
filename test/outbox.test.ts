import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

import { awsError, sesCalls, sesFailTimes, sesFailWith, sesReset } from "./fakes/ses";

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("outbox");
  account = await seedAccount();
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  sesReset();
  const { db } = await import("@/db");
  const { message, sendJob } = await import("@/db/schema");
  await db.delete(sendJob);
  await db.delete(message);
});

async function send(overrides: Record<string, unknown> = {}) {
  const { deliverMessage } = await import("@/server/send");
  return deliverMessage({
    orgId: account.orgId,
    mailboxId: account.mailboxId,
    to: [{ name: null, address: "someone@example.com" }],
    subject: "Hello",
    text: "Body text",
    ...overrides,
  });
}

async function jobFor(messageId: string) {
  const { db } = await import("@/db");
  const { sendJob } = await import("@/db/schema");
  const [row] = await db.select().from(sendJob).where(eq(sendJob.messageId, messageId));
  return row ?? null;
}

async function messageRow(id: string) {
  const { db } = await import("@/db");
  const { message } = await import("@/db/schema");
  const [row] = await db.select().from(message).where(eq(message.id, id));
  return row ?? null;
}

/* -------------------------------------------------------------------------- */

describe("classifying a send failure", () => {
  it("calls throttling and outages worth another try", async () => {
    const { isRetryableSendError } = await import("@/server/outbox");
    assert.equal(isRetryableSendError(awsError("Throttling")), true);
    assert.equal(isRetryableSendError(awsError("TooManyRequestsException")), true);
    assert.equal(
      isRetryableSendError(awsError("Whatever", { $metadata: { httpStatusCode: 503 } })),
      true,
    );
    assert.equal(isRetryableSendError(awsError("Nope", { code: "ECONNRESET" })), true);
  });

  it("calls a refusal final", async () => {
    const { isRetryableSendError } = await import("@/server/outbox");
    assert.equal(isRetryableSendError(awsError("MessageRejected")), false);
    assert.equal(isRetryableSendError(awsError("AccountSuspendedException")), false);
    assert.equal(
      isRetryableSendError(awsError("BadRequestException", { $metadata: { httpStatusCode: 400 } })),
      false,
    );
    // A 4xx that is not throttling is the message's fault, whatever it is called.
    assert.equal(
      isRetryableSendError(awsError("SomethingNew", { $metadata: { httpStatusCode: 422 } })),
      false,
    );
  });
});

describe("backing off", () => {
  it("grows and then stops growing", async () => {
    const { backoffMs } = await import("@/server/outbox");
    const first = backoffMs(1);
    const third = backoffMs(3);
    assert.ok(first >= 24_000 && first <= 36_000, `first was ${first}`);
    assert.ok(third > first, "later attempts wait longer");
    // Capped at fifteen minutes, plus the jitter.
    assert.ok(backoffMs(20) <= 15 * 60_000 * 1.2);
  });
});

/* -------------------------------------------------------------------------- */

describe("sending", () => {
  it("goes straight out when SES takes it", async () => {
    const result = await send();

    assert.equal(result.status, "sent");
    assert.equal(sesCalls.length, 1);
    assert.equal(await jobFor(result.messageId), null, "nothing is queued");

    const row = await messageRow(result.messageId);
    assert.equal(row?.deliveryStatus, "sent");
    assert.equal(row?.sesMessageId, "ses-fake-1");
    assert.ok(row?.sentAt, "the send time is recorded");
    assert.equal(row?.folder, "sent");
  });

  it("refuses, and records nothing, when SES will never take it", async () => {
    sesFailWith(() => awsError("MessageRejected"));

    const { SendError } = await import("@/server/send");
    await assert.rejects(send(), (error: unknown) => {
      assert.ok(error instanceof SendError);
      assert.equal((error as InstanceType<typeof SendError>).status, 502);
      return true;
    });

    const { db } = await import("@/db");
    const { message } = await import("@/db/schema");
    const rows = await db.select().from(message);
    assert.equal(rows.length, 0, "a refused message leaves no trace");
  });

  it("queues rather than losing the message when SES is busy", async () => {
    sesFailWith(() => awsError("Throttling"));

    const result = await send();
    assert.equal(result.status, "queued");
    assert.ok(result.queuedReason);

    const row = await messageRow(result.messageId);
    assert.equal(row?.deliveryStatus, "queued");
    assert.equal(row?.sentAt, null, "nothing has been sent yet");

    const job = await jobFor(result.messageId);
    assert.equal(job?.status, "pending");
    assert.equal(job?.attempts, 1, "the attempt that just failed counts");
    assert.ok(job && job.nextAttemptAt.getTime() > Date.now(), "it waits before trying again");
    assert.ok(job && job.rawMime.length > 0, "the built message is kept");
  });
});

/* -------------------------------------------------------------------------- */

describe("the queue", () => {
  it("sends what is due and marks it done", async () => {
    sesFailTimes(1, () => awsError("Throttling"));
    const result = await send();
    assert.equal(result.status, "queued");

    // Bring its turn forward rather than waiting half a minute.
    await makeDue(result.messageId);

    const { runOutboxOnce } = await import("@/server/outbox");
    const run = await runOutboxOnce();

    assert.deepEqual({ claimed: run.claimed, sent: run.sent }, { claimed: 1, sent: 1 });

    const row = await messageRow(result.messageId);
    assert.equal(row?.deliveryStatus, "sent");
    assert.ok(row?.sentAt);
    // The throttled attempt never got an id, so the retry is the first one.
    assert.equal(row?.sesMessageId, "ses-fake-1");

    const job = await jobFor(result.messageId);
    assert.equal(job?.status, "sent");
  });

  it("leaves a message that is not due yet alone", async () => {
    sesFailTimes(1, () => awsError("Throttling"));
    const result = await send();

    const { runOutboxOnce } = await import("@/server/outbox");
    const run = await runOutboxOnce();
    assert.equal(run.claimed, 0, "its turn has not come");
    assert.equal((await jobFor(result.messageId))?.status, "pending");
  });

  it("waits longer each time, and gives up in the end", async () => {
    sesFailWith(() => awsError("Throttling"));
    const result = await send();

    const { runOutboxOnce } = await import("@/server/outbox");
    const { db } = await import("@/db");
    const { sendJob } = await import("@/db/schema");

    // Two attempts short of the limit, so the next two passes end it.
    await db
      .update(sendJob)
      .set({ attempts: 6, maxAttempts: 8 })
      .where(eq(sendJob.messageId, result.messageId));

    await makeDue(result.messageId);
    const first = await runOutboxOnce();
    assert.equal(first.retried, 1);
    const retried = await jobFor(result.messageId);
    assert.equal(retried?.attempts, 7);
    assert.equal(retried?.status, "pending");
    assert.ok(retried && retried.nextAttemptAt.getTime() > Date.now());

    await makeDue(result.messageId);
    const second = await runOutboxOnce();
    assert.equal(second.failed, 1);

    const job = await jobFor(result.messageId);
    assert.equal(job?.status, "failed");
    assert.equal(job?.attempts, 8);

    const row = await messageRow(result.messageId);
    assert.equal(row?.deliveryStatus, "failed");
    assert.ok(row?.deliveryError);
  });

  it("stops at once when SES turns the message down for good", async () => {
    sesFailTimes(1, () => awsError("Throttling"));
    const result = await send();

    sesFailWith(() => awsError("MessageRejected"));
    await makeDue(result.messageId);

    const { runOutboxOnce } = await import("@/server/outbox");
    const run = await runOutboxOnce();

    assert.equal(run.failed, 1);
    const job = await jobFor(result.messageId);
    assert.equal(job?.status, "failed");
    assert.equal(job?.attempts, 2, "a refusal does not use up the remaining tries");
    assert.equal((await messageRow(result.messageId))?.deliveryStatus, "failed");
  });

  it("does not hand the same job to two workers", async () => {
    sesFailTimes(1, () => awsError("Throttling"));
    const result = await send();
    await makeDue(result.messageId);

    const { runOutboxOnce } = await import("@/server/outbox");
    const [a, b] = await Promise.all([runOutboxOnce(), runOutboxOnce()]);

    assert.equal(a.claimed + b.claimed, 1, "exactly one pass got it");
    assert.equal(sesCalls.length, 2, "the failed first send, and one retry");
  });

  it("picks up a job whose worker died", async () => {
    sesFailTimes(1, () => awsError("Throttling"));
    const result = await send();

    const { db } = await import("@/db");
    const { sendJob } = await import("@/db/schema");
    // Claimed ten minutes ago by a process that is not coming back.
    await db
      .update(sendJob)
      .set({ status: "sending", lockedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(sendJob.messageId, result.messageId));

    const { runOutboxOnce } = await import("@/server/outbox");
    const run = await runOutboxOnce();

    assert.equal(run.sent, 1, "it was released and then sent");
    assert.equal((await jobFor(result.messageId))?.status, "sent");
  });
});

/* -------------------------------------------------------------------------- */

describe("cancelling", () => {
  it("takes a waiting job out of the queue", async () => {
    sesFailTimes(1, () => awsError("Throttling"));
    const result = await send();

    const { cancelJobForMessage, runOutboxOnce } = await import("@/server/outbox");
    assert.equal(await cancelJobForMessage(result.messageId), true);

    await makeDue(result.messageId);
    const run = await runOutboxOnce();
    assert.equal(run.claimed, 0, "a cancelled job is never claimed");
  });

  it("refuses once a worker is holding it", async () => {
    sesFailTimes(1, () => awsError("Throttling"));
    const result = await send();

    const { db } = await import("@/db");
    const { sendJob } = await import("@/db/schema");
    await db
      .update(sendJob)
      .set({ status: "sending", lockedAt: new Date() })
      .where(eq(sendJob.messageId, result.messageId));

    const { cancelJobForMessage } = await import("@/server/outbox");
    assert.equal(await cancelJobForMessage(result.messageId), false);
  });
});

/* -------------------------------------------------------------------------- */

async function makeDue(messageId: string) {
  const { db } = await import("@/db");
  const { sendJob } = await import("@/db/schema");
  await db
    .update(sendJob)
    .set({ nextAttemptAt: new Date(Date.now() - 1000) })
    .where(and(eq(sendJob.messageId, messageId), eq(sendJob.status, "pending")));
}
