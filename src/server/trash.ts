import "server-only";
import { db } from "@/db";
import { message, thread } from "@/db/schema";
import { recomputeThread } from "@/server/aggregate";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

/**
 * Throwing conversations away and getting them back.
 *
 * Apart from the actions that call it so that it can be exercised without a
 * request around it: which folder a message returns to is the sort of thing
 * that is wrong for weeks before anyone notices.
 */

/**
 * Moves conversations to the trash, or destroys them if that is where they
 * already are. Ownership is the caller's to check.
 */
export async function trashThreads(threadIds: string[]) {
  if (threadIds.length === 0) return;

  const rows = await db.select().from(thread).where(inArray(thread.id, threadIds));
  const purge = rows.filter((row) => row.folders.length === 1 && row.folders[0] === "trash");
  const trash = rows.filter((row) => !purge.includes(row));

  if (purge.length > 0) {
    await db.delete(thread).where(
      inArray(
        thread.id,
        purge.map((row) => row.id),
      ),
    );
  }

  if (trash.length > 0) {
    const ids = trash.map((row) => row.id);
    // Remember where each message was, so putting it back means what it says.
    // Only the ones actually moving: a message already in the trash would
    // otherwise record "trash" as the place it came from.
    await db
      .update(message)
      .set({ folder: "trash", previousFolder: sql`${message.folder}` })
      .where(and(inArray(message.threadId, ids), ne(message.folder, "trash")));
    for (const id of ids) await recomputeThread(id);
  }
}

/**
 * Puts conversations back where they came from.
 *
 * Each message returns to its own folder, which is the whole point: a reply
 * you wrote goes back to Sent and the message it answered goes back to the
 * inbox, and the conversation reads the way it did before.
 */
export async function restoreThreads(threadIds: string[]) {
  if (threadIds.length === 0) return;

  await db
    .update(message)
    .set({
      /**
       * Anything trashed before this column existed has no record of where it
       * was. A message this account sent is a sent message, whatever else is
       * unknown about it — which beats putting everything in the inbox and
       * calling it a restore.
       */
      folder: sql`coalesce(${message.previousFolder}, case when ${message.isOutbound} then 'sent'::folder else 'inbox'::folder end)`,
      previousFolder: null,
    })
    .where(
      and(
        inArray(message.threadId, threadIds),
        eq(message.folder, "trash"),
        eq(message.isDraft, false),
      ),
    );

  for (const id of threadIds) await recomputeThread(id);
}

/**
 * Throws away everything in the trash for the given mailboxes, and says how
 * many conversations it touched.
 *
 * Messages are what the trash holds, not conversations: a thread can have a
 * reply still sitting in Sent while the message it answered is deleted. So
 * this removes the deleted messages and leaves the rest of the thread alone.
 * A thread with nothing left is dropped by {@link recomputeThread}.
 */
export async function emptyTrash(mailboxIds: string[]) {
  if (mailboxIds.length === 0) return 0;

  const rows = await db
    .select({ id: message.id, threadId: message.threadId })
    .from(message)
    .innerJoin(thread, eq(thread.id, message.threadId))
    .where(and(eq(message.folder, "trash"), inArray(thread.mailboxId, mailboxIds)));
  if (rows.length === 0) return 0;

  await db.delete(message).where(
    inArray(
      message.id,
      rows.map((row) => row.id),
    ),
  );

  const touched = [...new Set(rows.map((row) => row.threadId))];
  for (const id of touched) await recomputeThread(id);
  return touched.length;
}
