import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * Paging the mailbox goes both ways, and the two directions have to agree:
 * stepping forward and back again must land on the same rows, with nothing
 * repeated and nothing skipped over. A cursor read backwards walks away from
 * itself, so the rows come out of Postgres in the wrong order and are turned
 * around — which is exactly where an off-by-one would hide.
 */

let scratch: Scratch;
let account: Seeded;

const TOTAL = 120;

before(async () => {
  scratch = makeScratchDatabase("paging");
  account = await seedAccount();

  const { db } = await import("@/db");
  const { thread } = await import("@/db/schema");

  // Newest first when read back: thread 0 is the oldest.
  await db.insert(thread).values(
    Array.from({ length: TOTAL }, (_, index) => ({
      id: `thr_${String(index).padStart(4, "0")}`,
      mailboxId: account.mailboxId,
      subject: `Thread ${index}`,
      folders: ["inbox" as const],
      messageCount: 1,
      lastMessageAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000),
    })),
  );
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

async function page(cursor?: string, direction: "older" | "newer" = "older") {
  const { listThreads } = await import("@/server/threads");
  return listThreads({
    orgId: account.orgId,
    scope: { kind: "all" },
    folder: "inbox",
    cursor,
    direction,
  });
}

const subjects = (rows: { subject: string }[]) => rows.map((row) => row.subject);

describe("paging a mailbox", () => {
  it("starts at the newest and offers no way back", async () => {
    const first = await page();
    assert.equal(first.items.length, 50);
    assert.equal(first.items[0]!.subject, "Thread 119", "newest first");
    assert.equal(first.prevCursor, null, "nothing is newer than the first page");
    assert.ok(first.nextCursor, "there is more to read");
  });

  it("walks forward without repeating or skipping a thread", async () => {
    const one = await page();
    const two = await page(one.nextCursor!);
    const three = await page(two.nextCursor!);

    assert.equal(two.items.length, 50);
    assert.equal(three.items.length, 20, "the last page is what is left");
    assert.equal(three.nextCursor, null, "and offers nothing further");

    const seen = [...subjects(one.items), ...subjects(two.items), ...subjects(three.items)];
    assert.equal(new Set(seen).size, TOTAL, "every thread, once");
    assert.equal(seen[0], "Thread 119");
    assert.equal(seen.at(-1), "Thread 0");
  });

  it("comes back to exactly the page it left", async () => {
    const one = await page();
    const two = await page(one.nextCursor!);
    const three = await page(two.nextCursor!);

    const backToTwo = await page(three.prevCursor!, "newer");
    assert.deepEqual(subjects(backToTwo.items), subjects(two.items));

    const backToOne = await page(backToTwo.prevCursor!, "newer");
    assert.deepEqual(subjects(backToOne.items), subjects(one.items));
  });

  it("stops offering Newer once it is back at the top", async () => {
    const one = await page();
    const two = await page(one.nextCursor!);
    const backToOne = await page(two.prevCursor!, "newer");

    assert.deepEqual(subjects(backToOne.items), subjects(one.items));
    assert.equal(backToOne.prevCursor, null, "nothing is newer than the first page");
  });

  it("still offers Older after stepping back, since that is where it came from", async () => {
    const one = await page();
    const two = await page(one.nextCursor!);
    const backToOne = await page(two.prevCursor!, "newer");

    assert.ok(backToOne.nextCursor, "the way forward is still there");
    const forwardAgain = await page(backToOne.nextCursor!);
    assert.deepEqual(subjects(forwardAgain.items), subjects(two.items));
  });
});
