import { db } from "@/db";
import { folderEnum, label, mailbox, message, thread, threadLabel } from "@/db/schema";
import { boolOf, dateOf, fail, limitOf, makeCursor, page, splitCursor } from "@/lib/api-http";
import { apiRoute, scopedMailboxIds } from "@/server/api-auth";
import { serializeThread } from "@/server/api-serialize";
import { and, arrayContains, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Folder = (typeof folderEnum.enumValues)[number];

/**
 * GET /api/v1/threads — conversations, newest activity first.
 *
 * This is the endpoint that makes Mailroom readable from outside the web app:
 * inbound mail lives in threads, and everything else here narrows them.
 *
 * Filters: `folder`, `label_id`, `label`, `q`, `unread`, `starred`,
 * `has_attachments`, `participant`, `subject`, `since`, `until`,
 * `mailbox_id`, `mailbox`, `domain`.
 */
export const GET = apiRoute("mail:read", async ({ caller, url }) => {
  const mailboxIds = await scopedMailboxIds(caller, url);
  if (mailboxIds.length === 0) return page([], null);

  const limit = limitOf(url);
  const filters = [inArray(thread.mailboxId, mailboxIds)];

  const folder = url.searchParams.get("folder");
  if (folder && folder !== "all") {
    if (!(folderEnum.enumValues as readonly string[]).includes(folder)) {
      return fail(
        "invalid_request",
        `folder must be "all" or one of: ${folderEnum.enumValues.join(", ")}`,
      );
    }
    filters.push(arrayContains(thread.folders, [folder as Folder]));
  }

  const unread = boolOf(url, "unread");
  if (unread === true) filters.push(sql`${thread.unreadCount} > 0`);
  if (unread === false) filters.push(sql`${thread.unreadCount} = 0`);

  const starred = boolOf(url, "starred");
  if (starred !== null) filters.push(eq(thread.isStarred, starred));

  const attachments = boolOf(url, "has_attachments");
  if (attachments !== null) filters.push(eq(thread.hasAttachments, attachments));

  const labelId = url.searchParams.get("label_id");
  const labelName = url.searchParams.get("label");
  if (labelId || labelName) {
    const [row] = await db
      .select({ id: label.id })
      .from(label)
      .where(
        and(
          eq(label.organizationId, caller.orgId),
          labelId ? eq(label.id, labelId) : eq(label.name, labelName as string),
        ),
      )
      .limit(1);
    if (!row) return page([], null);
    filters.push(
      sql`EXISTS (SELECT 1 FROM ${threadLabel} tl WHERE tl.thread_id = ${thread.id} AND tl.label_id = ${row.id})`,
    );
  }

  const subject = url.searchParams.get("subject");
  if (subject) filters.push(ilike(thread.subject, `%${subject}%`));

  const participant = url.searchParams.get("participant")?.toLowerCase().trim();
  if (participant) {
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${thread.participants}) AS p
        WHERE lower(p->>'address') = ${participant}
      )`,
    );
  }

  const query = url.searchParams.get("q")?.trim();
  if (query) {
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM ${message} m
        WHERE m.thread_id = ${thread.id}
          AND (
            m.search_vector @@ websearch_to_tsquery('english', ${query})
            OR m.from_address ILIKE ${`%${query}%`}
            OR m.subject ILIKE ${`%${query}%`}
          )
      )`,
    );
  }

  const since = dateOf(url, "since");
  if (since) filters.push(gte(thread.lastMessageAt, since));
  const until = dateOf(url, "until");
  if (until) filters.push(lte(thread.lastMessageAt, until));

  const cursor = splitCursor(url.searchParams.get("next_cursor") ?? url.searchParams.get("cursor"));
  if (cursor) {
    const [stamp, id] = cursor;
    const at = new Date(Number(stamp));
    filters.push(
      or(lt(thread.lastMessageAt, at), and(eq(thread.lastMessageAt, at), lt(thread.id, id)))!,
    );
  }

  const rows = await db
    .select({
      row: thread,
      address: mailbox.address,
      color: mailbox.color,
      domain: mailbox.domain,
    })
    .from(thread)
    .innerJoin(mailbox, eq(mailbox.id, thread.mailboxId))
    .where(and(...filters))
    .orderBy(desc(thread.lastMessageAt), desc(thread.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  // Labels for the whole page in one query rather than one per thread.
  const labelsByThread = await labelsFor(items.map((entry) => entry.row.id));

  return page(
    items.map((entry) =>
      serializeThread(entry.row, {
        mailboxAddress: entry.address,
        mailboxColor: entry.color,
        domain: entry.domain,
        labels: labelsByThread.get(entry.row.id) ?? [],
      }),
    ),
    hasMore && last ? makeCursor(last.row.lastMessageAt, last.row.id) : null,
  );
});

async function labelsFor(threadIds: string[]) {
  const map = new Map<string, (typeof label.$inferSelect)[]>();
  if (threadIds.length === 0) return map;

  const rows = await db
    .select({ threadId: threadLabel.threadId, row: label })
    .from(threadLabel)
    .innerJoin(label, eq(label.id, threadLabel.labelId))
    .where(inArray(threadLabel.threadId, threadIds));

  for (const entry of rows) {
    const list = map.get(entry.threadId) ?? [];
    list.push(entry.row);
    map.set(entry.threadId, list);
  }
  return map;
}
