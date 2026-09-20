import "server-only";
import { db } from "@/db";
import { attachment, message, thread } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Threads cache what their messages say (folders, counts, snippet, participants).
 * Call this after any write that touches a message so the list view stays honest.
 */
export async function recomputeThread(threadId: string) {
  const messages = await db.query.message.findMany({
    where: eq(message.threadId, threadId),
    orderBy: (m, { asc }) => [asc(m.receivedAt)],
  });

  if (messages.length === 0) {
    await db.delete(thread).where(eq(thread.id, threadId));
    return;
  }

  const latest = messages.at(-1)!;
  const folders = [...new Set(messages.map((m) => m.folder))];

  const participants = new Map<string, { name: string | null; address: string }>();
  for (const item of messages) {
    participants.set(item.fromAddress, {
      name: item.fromName ?? null,
      address: item.fromAddress,
    });
    for (const entry of [...item.to, ...item.cc]) {
      if (!participants.has(entry.address)) participants.set(entry.address, entry);
    }
  }

  const [attachmentCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attachment)
    .innerJoin(message, eq(message.id, attachment.messageId))
    .where(eq(message.threadId, threadId));

  await db
    .update(thread)
    .set({
      subject: latest.subject,
      snippet: latest.snippet,
      folders,
      participants: [...participants.values()],
      messageCount: messages.length,
      unreadCount: messages.filter((m) => !m.isRead && !m.isOutbound).length,
      isStarred: messages.some((m) => m.isStarred),
      hasAttachments: (attachmentCount?.count ?? 0) > 0,
      lastMessageAt: latest.receivedAt,
    })
    .where(eq(thread.id, threadId));
}
