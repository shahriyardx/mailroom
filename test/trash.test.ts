import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * Putting a conversation back has to mean back, not "into the inbox".
 *
 * A thread holds messages from both sides. Restoring the lot to one folder
 * puts a reply somebody wrote among the messages they received, which is how
 * a sent-only conversation ended up in an inbox it had never been in.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("trash");
  account = await seedAccount();
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { message, thread } = await import("@/db/schema");
  await db.delete(message);
  await db.delete(thread);
});

/** A conversation, with each message in the folder it belongs to. */
async function conversation(folders: ("inbox" | "sent")[]) {
  const { db } = await import("@/db");
  const { message, thread } = await import("@/db/schema");
  const { newId } = await import("@/lib/utils");

  const threadId = newId("thr");
  await db.insert(thread).values({
    id: threadId,
    mailboxId: account.mailboxId,
    subject: "Hello How are you",
    folders: [...new Set(folders)],
    messageCount: folders.length,
  });

  for (const [index, folder] of folders.entries()) {
    await db.insert(message).values({
      id: newId("msg"),
      threadId,
      mailboxId: account.mailboxId,
      rfcMessageId: `<${newId("m")}@example.test>`,
      fromAddress: folder === "sent" ? account.address : "them@example.com",
      subject: "Hello How are you",
      folder,
      isOutbound: folder === "sent",
      receivedAt: new Date(Date.UTC(2026, 8, 21, 20, index)),
    });
  }

  return threadId;
}

async function foldersNow(threadId: string) {
  const { db } = await import("@/db");
  const { message } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db.select().from(message).where(eq(message.threadId, threadId));
  return rows.map((row) => row.folder).sort();
}

describe("putting a conversation back", () => {
  it("returns each message to its own folder", async () => {
    const { restoreThreads, trashThreads } = await import("@/server/trash");
    const id = await conversation(["inbox", "sent"]);

    await trashThreads([id]);
    assert.deepEqual(await foldersNow(id), ["trash", "trash"]);

    await restoreThreads([id]);
    assert.deepEqual(
      await foldersNow(id),
      ["inbox", "sent"],
      "their message to the inbox, mine to sent",
    );
  });

  it("puts a conversation nobody replied to back in Sent", async () => {
    const { restoreThreads, trashThreads } = await import("@/server/trash");
    const id = await conversation(["sent"]);

    await trashThreads([id]);
    await restoreThreads([id]);

    assert.deepEqual(await foldersNow(id), ["sent"], "it was never in an inbox");
  });

  it("falls back to whether we sent it, for anything trashed before this was kept", async () => {
    const { db } = await import("@/db");
    const { message } = await import("@/db/schema");
    const { restoreThreads } = await import("@/server/trash");
    const { eq } = await import("drizzle-orm");

    const id = await conversation(["inbox", "sent"]);
    // Trashed the old way: no record of where anything was.
    await db
      .update(message)
      .set({ folder: "trash", previousFolder: null })
      .where(eq(message.threadId, id));

    await restoreThreads([id]);
    assert.deepEqual(await foldersNow(id), ["inbox", "sent"]);
  });

  it("does not record the trash as somewhere to go back to", async () => {
    const { db } = await import("@/db");
    const { message } = await import("@/db/schema");
    const { trashThreads } = await import("@/server/trash");
    const { eq } = await import("drizzle-orm");

    const id = await conversation(["inbox"]);
    await trashThreads([id]);
    // A second delete must not overwrite the answer with "trash".
    await trashThreads([id]).catch(() => {});

    const rows = await db.select().from(message).where(eq(message.threadId, id));
    for (const row of rows) {
      assert.notEqual(row.previousFolder, "trash", "that is not a place to put anything back");
    }
  });
});

describe("emptying the trash", () => {
  it("destroys what is in the trash and leaves the rest of the thread", async () => {
    const { db } = await import("@/db");
    const { message, thread } = await import("@/db/schema");
    const { emptyTrash, trashThreads } = await import("@/server/trash");
    const { and, eq } = await import("drizzle-orm");

    const gone = await conversation(["inbox"]);
    const mixed = await conversation(["inbox", "sent"]);
    const kept = await conversation(["inbox"]);

    await trashThreads([gone]);
    // Only their half of this one was deleted; the reply is still in Sent.
    await db
      .update(message)
      .set({ folder: "trash", previousFolder: "inbox" })
      .where(and(eq(message.threadId, mixed), eq(message.folder, "inbox")));

    const count = await emptyTrash([account.mailboxId]);
    assert.equal(count, 2, "both conversations with trashed mail");

    const remaining = await db.select().from(thread);
    assert.deepEqual(
      remaining.map((row) => row.id).sort(),
      [kept, mixed].sort(),
      "the one wholly in the trash is gone, the untouched one stays",
    );
    assert.deepEqual(await foldersNow(mixed), ["sent"], "my reply survives");
  });

  it("does not reach a mailbox the view does not cover", async () => {
    const { db } = await import("@/db");
    const { thread } = await import("@/db/schema");
    const { emptyTrash, trashThreads } = await import("@/server/trash");

    const id = await conversation(["inbox"]);
    await trashThreads([id]);

    assert.equal(await emptyTrash(["mbx_somewhere_else"]), 0);
    assert.equal((await db.select().from(thread)).length, 1, "still there");
  });
});
