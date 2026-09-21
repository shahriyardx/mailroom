import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * A reply has to land in the conversation it answers.
 *
 * SES replaces the Message-ID we write with one of its own, so the header a
 * reply carries is not the one we stored as `rfcMessageId`. The ids below are
 * the real pair from a message that failed to thread.
 *
 * Every reply here carries a subject of its own, so that matching on headers
 * is what is actually being tested. Threading falls back to the subject, and a
 * reply that kept "Re: <the same subject>" would join the conversation whether
 * the headers were read correctly or not.
 */

let scratch: Scratch;
let account: Seeded;

const OURS = "<8bbc1a1f-9194-4875-9a0f-33290650ffe2@ccbot.app>";
const SES_ID = "010001a0c5907e7d-a5c4fc14-127c-4d8b-8bfb-4ee2a5069fb5-000000";

before(async () => {
  scratch = makeScratchDatabase("threading");
  account = await seedAccount();
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

/**
 * A message this account sent, as the send path records one.
 *
 * Each gets its own pair of ids: a mailbox may not hold the same Message-ID
 * twice, which is the database saying the same thing this is about.
 */
async function sent(tag: string) {
  const ours = OURS.replace("8bbc1a1f", `8bbc1a1f-${tag}`);
  const ses = `${SES_ID}-${tag}`;
  const { db } = await import("@/db");
  const { message, thread } = await import("@/db/schema");
  const { newId } = await import("@/lib/utils");

  const threadId = newId("thr");
  await db.insert(thread).values({
    id: threadId,
    mailboxId: account.mailboxId,
    subject: "Advanced is live — receipt inside",
    folders: ["sent" as const],
    messageCount: 1,
  });

  const id = newId("msg");
  await db.insert(message).values({
    id,
    threadId,
    mailboxId: account.mailboxId,
    rfcMessageId: ours,
    sesMessageId: ses,
    fromAddress: account.address,
    to: [{ name: null, address: "someone@example.com" }],
    subject: "Advanced is live — receipt inside",
    folder: "sent",
    isOutbound: true,
  });

  return { id, threadId, ours, pointedAt: `<${ses}@email.amazonses.com>` };
}

async function arrive(headers: { inReplyTo?: string; references?: string[]; subject?: string }) {
  const { ingestInbound } = await import("@/server/ingest");
  await ingestInbound(
    {
      to: account.address,
      from: { name: "Someone", address: "someone@example.com" },
      toAddresses: [{ name: null, address: account.address }],
      subject: headers.subject ?? "Re: a subject that matches nothing",
      text: "Thanks for the information",
      messageId: `<reply-${headers.inReplyTo ?? headers.references?.join("") ?? headers.subject}@mail.gmail.com>`,
      inReplyTo: headers.inReplyTo ?? null,
      references: headers.references ?? [],
    },
    [],
  );

  const { db } = await import("@/db");
  const { message } = await import("@/db/schema");
  const { desc } = await import("drizzle-orm");
  const [row] = await db.select().from(message).orderBy(desc(message.createdAt)).limit(1);
  return row!;
}

describe("a reply to something we sent", () => {
  it("joins the conversation when it points at the id SES gave the message", async () => {
    const original = await sent("a");
    const reply = await arrive({ inReplyTo: original.pointedAt });

    assert.equal(
      reply.threadId,
      original.threadId,
      "the header points at the SES id, which is the one that left the building",
    );
  });

  it("still joins when the id is buried in References rather than In-Reply-To", async () => {
    const original = await sent("b");
    const reply = await arrive({
      references: ["<something-else@example.com>", original.pointedAt],
    });

    assert.equal(reply.threadId, original.threadId);
  });

  it("still honours our own Message-ID, for anything that did not go through SES", async () => {
    const original = await sent("c");
    const reply = await arrive({ inReplyTo: original.ours });

    assert.equal(reply.threadId, original.threadId);
  });

  it("does not drag in an unrelated conversation", async () => {
    const original = await sent("d");
    const reply = await arrive({
      inReplyTo: "<0000-nothing-we-ever-sent-0000@email.amazonses.com>",
      subject: "Something else entirely",
    });

    assert.notEqual(reply.threadId, original.threadId);
  });
});
