import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { sesCalls, sesReset } from "./fakes/ses";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("testmode");
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
  const { message, messageEvent, sendJob } = await import("@/db/schema");
  await db.delete(sendJob);
  await db.delete(messageEvent);
  await db.delete(message);
});

function caller(testMode: boolean) {
  return {
    keyId: testMode ? "key_test" : "key_live",
    keyName: testMode ? "test" : "live",
    orgId: account.orgId,
    reach: { mailboxIds: [], domainIds: [], unrestricted: true },
    scopes: new Set(["*"]),
    rawScopes: ["*"],
    rateLimit: 300,
    testMode,
  };
}

async function sendAs(testMode: boolean, to = "someone@example.com") {
  const { sendOne } = await import("@/server/api-send");
  return sendOne(caller(testMode), {
    from: account.address,
    to,
    subject: "Hello",
    text: "Body",
  });
}

async function rowFor(id: string) {
  const { db } = await import("@/db");
  const { message } = await import("@/db/schema");
  const [row] = await db.select().from(message).where(eq(message.id, id));
  return row ?? null;
}

/* -------------------------------------------------------------------------- */

describe("a test key", () => {
  it("records the send and never reaches SES", async () => {
    const result = await sendAs(true);

    assert.equal(sesCalls.length, 0, "nothing was handed over");
    assert.equal(result.test, true);

    const row = await rowFor(result.id);
    assert.equal(row?.isTest, true);
    assert.equal(row?.deliveryStatus, "delivered");
    assert.equal(row?.sesMessageId, null);
    assert.ok(row?.sentAt, "it still counts as having gone out at a time");
    assert.equal(row?.folder, "sent");
  });

  it("still runs every check a live key runs", async () => {
    const { db } = await import("@/db");
    const { suppression } = await import("@/db/schema");
    const { newId } = await import("@/lib/utils");
    const { SendError } = await import("@/server/send");

    await db.insert(suppression).values({
      id: newId("sup"),
      organizationId: account.orgId,
      address: "blocked@example.com",
      reason: "bounce",
    });

    await assert.rejects(
      sendAs(true, "blocked@example.com"),
      (error: unknown) => error instanceof SendError,
    );
  });

  it("makes the outcome match who it is addressed to", async () => {
    for (const [address, expected] of [
      ["bounce@example.com", "bounced"],
      ["bounced@example.com", "bounced"],
      ["complaint@example.com", "complained"],
      ["delay@example.com", "delayed"],
      ["ada@example.com", "delivered"],
    ] as const) {
      const result = await sendAs(true, address);
      const row = await rowFor(result.id);
      assert.equal(row?.deliveryStatus, expected, address);
    }
  });

  it("writes the timeline a real send would have grown", async () => {
    const result = await sendAs(true, "bounce@example.com");

    const { db } = await import("@/db");
    const { messageEvent } = await import("@/db/schema");
    const events = await db
      .select()
      .from(messageEvent)
      .where(eq(messageEvent.messageId, result.id));

    assert.deepEqual(
      events.map((row) => row.type).sort(),
      ["bounce", "send"],
      "a send and the bounce it was made to look like",
    );
  });

  it("can be scheduled, and goes nowhere when its turn comes", async () => {
    const { sendOne } = await import("@/server/api-send");
    const result = await sendOne(caller(true), {
      from: account.address,
      to: "someone@example.com",
      subject: "Later",
      text: "Body",
      scheduled_at: "in 1 hour",
    });

    assert.equal(result.status, "scheduled");

    const { db } = await import("@/db");
    const { sendJob } = await import("@/db/schema");
    await db
      .update(sendJob)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(sendJob.messageId, result.id));

    // The worker does take the job — but a test message is still a test
    // message once it is in the queue, and must not reach SES on its way out.
    const { runOutboxOnce } = await import("@/server/outbox");
    const run = await runOutboxOnce();

    assert.equal(run.sent, 1);
    assert.equal(sesCalls.length, 0, "the queue did not hand it over either");

    const row = await rowFor(result.id);
    assert.equal(row?.isTest, true);
    assert.equal(row?.deliveryStatus, "delivered");
    assert.equal(row?.sesMessageId, null);
    assert.ok(row?.sentAt);
    assert.equal(row?.scheduledAt, null);
  });

  it("writes the timeline for a scheduled one too", async () => {
    const { sendOne } = await import("@/server/api-send");
    const result = await sendOne(caller(true), {
      from: account.address,
      to: "bounce@example.com",
      subject: "Later",
      text: "Body",
      scheduled_at: "in 1 hour",
    });

    const { db } = await import("@/db");
    const { messageEvent, sendJob } = await import("@/db/schema");
    await db
      .update(sendJob)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(sendJob.messageId, result.id));

    const { runOutboxOnce } = await import("@/server/outbox");
    await runOutboxOnce();

    const events = await db
      .select()
      .from(messageEvent)
      .where(eq(messageEvent.messageId, result.id));

    assert.deepEqual(events.map((row) => row.type).sort(), ["bounce", "send"]);
    assert.equal((await rowFor(result.id))?.deliveryStatus, "bounced");
  });
});

/* -------------------------------------------------------------------------- */

describe("keeping the two apart", () => {
  it("shows a live key only real mail, and a test key only test mail", async () => {
    const { testFilter } = await import("@/server/api-auth");
    const plain = new URL("https://example.test/api/v1/emails");

    const live = testFilter(caller(false), plain);
    const test = testFilter(caller(true), plain);

    assert.ok(live, "a live key is filtered");
    assert.ok(test, "a test key is filtered");

    // The two conditions differ; the query itself is exercised below.
    const { db } = await import("@/db");
    const { message } = await import("@/db/schema");

    const liveSend = await sendAs(false);
    const testSend = await sendAs(true);

    const liveRows = await db.select({ id: message.id }).from(message).where(live);
    const testRows = await db.select({ id: message.id }).from(message).where(test);

    assert.deepEqual(
      liveRows.map((row) => row.id),
      [liveSend.id],
    );
    assert.deepEqual(
      testRows.map((row) => row.id),
      [testSend.id],
    );
  });

  it("lets either side ask for the other, or for both", async () => {
    const { testFilter } = await import("@/server/api-auth");

    assert.equal(testFilter(caller(false), new URL("https://x.test/?test=all")), null);
    assert.equal(testFilter(caller(true), new URL("https://x.test/?test=all")), null);
    assert.ok(testFilter(caller(false), new URL("https://x.test/?test=true")));
    assert.ok(testFilter(caller(true), new URL("https://x.test/?test=false")));
  });

  it("shows both sides to a key that asks for both", async () => {
    const { testFilter } = await import("@/server/api-auth");
    const { db } = await import("@/db");
    const { message } = await import("@/db/schema");

    const liveSend = await sendAs(false);
    const testSend = await sendAs(true);

    const filter = testFilter(caller(true), new URL("https://x.test/?test=all"));
    assert.equal(filter, null, "nothing is filtered out");

    const rows = await db.select({ id: message.id }).from(message);
    const ids = rows.map((row) => row.id);
    assert.ok(ids.includes(testSend.id));
    assert.ok(ids.includes(liveSend.id));
  });
});

/* -------------------------------------------------------------------------- */

describe("telling the keys apart", () => {
  it("gives a test key a prefix you can see", async () => {
    const { generateApiKey } = await import("@/lib/api-key");
    assert.match(generateApiKey("test").token, /^mk_test_/);
    assert.match(generateApiKey("live").token, /^mk_live_/);
    assert.match(generateApiKey().token, /^mk_live_/, "live is still the default");
  });
});
