import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { sesCalls, sesReset } from "./fakes/ses";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("sched");
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
    subject: "Later",
    text: "Body",
    ...overrides,
  });
}

/** An API key that can reach everything in the seeded account. */
function caller() {
  return {
    keyId: "key_test",
    keyName: "test",
    orgId: account.orgId,
    reach: { mailboxIds: [], domainIds: [], unrestricted: true },
    scopes: new Set(["*"]),
    rawScopes: ["*"],
    rateLimit: 300,
    testMode: false,
  };
}

/* -------------------------------------------------------------------------- */

describe("reading a time", () => {
  it("takes an ISO timestamp", async () => {
    const { parseSchedule } = await import("@/lib/schedule");
    const result = parseSchedule("2026-10-01T09:00:00Z", Date.parse("2026-09-21T00:00:00Z"));
    assert.ok("at" in result);
    assert.equal(result.at.toISOString(), "2026-10-01T09:00:00.000Z");
  });

  it("takes the way people say it", async () => {
    const { parseSchedule } = await import("@/lib/schedule");
    const now = Date.parse("2026-09-21T00:00:00Z");

    for (const [text, minutes] of [
      ["in 30 minutes", 30],
      ["in 30 min", 30],
      ["in 2 hours", 120],
      ["in 1 day", 1440],
      ["IN 5 MINUTES", 5],
    ] as const) {
      const result = parseSchedule(text, now);
      assert.ok("at" in result, `${text} should parse`);
      assert.equal(result.at.getTime() - now, minutes * 60_000, text);
    }
  });

  it("takes a Unix time in either unit", async () => {
    const { parseSchedule } = await import("@/lib/schedule");
    const now = Date.parse("2026-09-21T00:00:00Z");
    const seconds = Math.floor(Date.parse("2026-09-22T00:00:00Z") / 1000);

    const fromSeconds = parseSchedule(seconds, now);
    const fromMillis = parseSchedule(seconds * 1000, now);
    assert.ok("at" in fromSeconds && "at" in fromMillis);
    assert.equal(fromSeconds.at.getTime(), fromMillis.at.getTime());
  });

  it("says so when it cannot read it", async () => {
    const { parseSchedule } = await import("@/lib/schedule");
    for (const bad of ["next tuesday-ish", "", "soon", "in many minutes"]) {
      const result = parseSchedule(bad);
      assert.ok("error" in result, `${bad} should be refused`);
    }
  });

  it("refuses a time too far out to be an email", async () => {
    const { MAX_SCHEDULE_DAYS, parseSchedule } = await import("@/lib/schedule");
    const now = Date.now();
    const result = parseSchedule(new Date(now + (MAX_SCHEDULE_DAYS + 1) * 86_400_000), now);
    assert.ok("error" in result);
  });
});

/* -------------------------------------------------------------------------- */

describe("scheduling a send", () => {
  it("holds it, and does not go near SES", async () => {
    const at = new Date(Date.now() + 3_600_000);
    const result = await send({ scheduledAt: at });

    assert.equal(result.status, "scheduled");
    assert.equal(sesCalls.length, 0, "nothing was handed over");

    const { db } = await import("@/db");
    const { message, sendJob } = await import("@/db/schema");

    const [row] = await db.select().from(message).where(eq(message.id, result.messageId));
    assert.equal(row?.deliveryStatus, "queued");
    assert.equal(row?.sentAt, null);
    assert.equal(row?.scheduledAt?.getTime(), at.getTime());

    const [job] = await db.select().from(sendJob).where(eq(sendJob.messageId, result.messageId));
    assert.equal(job?.status, "pending");
    assert.equal(job?.attempts, 0, "waiting is not a failed attempt");
    assert.equal(job?.nextAttemptAt.getTime(), at.getTime());
  });

  it("sends now when the time has already been and gone", async () => {
    const result = await send({ scheduledAt: new Date(Date.now() - 60_000) });
    assert.equal(result.status, "sent");
    assert.equal(sesCalls.length, 1);
  });

  it("goes out when its time comes, and not before", async () => {
    const at = new Date(Date.now() + 3_600_000);
    const result = await send({ scheduledAt: at });

    const { runOutboxOnce } = await import("@/server/outbox");
    assert.equal((await runOutboxOnce()).claimed, 0, "not yet");

    const { db } = await import("@/db");
    const { message, sendJob } = await import("@/db/schema");
    await db
      .update(sendJob)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(sendJob.messageId, result.messageId));

    const run = await runOutboxOnce();
    assert.equal(run.sent, 1);
    assert.equal(sesCalls.length, 1);

    const [row] = await db.select().from(message).where(eq(message.id, result.messageId));
    assert.equal(row?.deliveryStatus, "sent");
    assert.equal(row?.scheduledAt, null, "it is no longer waiting for anything");
    assert.ok(row?.sentAt);
  });
});

/* -------------------------------------------------------------------------- */

describe("changing your mind", () => {
  it("cancels one that has not gone out", async () => {
    const result = await send({ scheduledAt: new Date(Date.now() + 3_600_000) });

    const { cancelSend } = await import("@/server/scheduling");
    const outcome = await cancelSend(caller(), result.messageId);

    assert.ok(outcome.ok);
    assert.equal(outcome.message.deliveryStatus, "canceled");

    const { runOutboxOnce } = await import("@/server/outbox");
    const { db } = await import("@/db");
    const { sendJob } = await import("@/db/schema");
    await db
      .update(sendJob)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(sendJob.messageId, result.messageId));

    assert.equal((await runOutboxOnce()).claimed, 0, "a cancelled job is never picked up");
    assert.equal(sesCalls.length, 0);
  });

  it("refuses to cancel one already sent", async () => {
    const result = await send();
    const { cancelSend } = await import("@/server/scheduling");
    const outcome = await cancelSend(caller(), result.messageId);

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.status, 409);
  });

  it("says not found for a message the key cannot reach", async () => {
    const { cancelSend } = await import("@/server/scheduling");
    const outcome = await cancelSend({ ...caller(), orgId: "org_somebody_else" }, "msg_nope");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.status, 404);
  });

  it("moves one to a different time", async () => {
    const first = new Date(Date.now() + 3_600_000);
    const second = new Date(Date.now() + 7_200_000);
    const result = await send({ scheduledAt: first });

    const { rescheduleSend } = await import("@/server/scheduling");
    const outcome = await rescheduleSend(caller(), result.messageId, second);
    assert.ok(outcome.ok);
    assert.equal(outcome.message.scheduledAt?.getTime(), second.getTime());

    const { db } = await import("@/db");
    const { sendJob } = await import("@/db/schema");
    const [job] = await db.select().from(sendJob).where(eq(sendJob.messageId, result.messageId));
    assert.equal(job?.nextAttemptAt.getTime(), second.getTime());
  });
});
