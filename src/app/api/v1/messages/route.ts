import { db } from "@/db";
import { folderEnum, mailbox, message } from "@/db/schema";
import { boolOf, dateOf, fail, limitOf, makeCursor, page, splitCursor } from "@/lib/api-http";
import { apiRoute, scopedMailboxIds, testFilter } from "@/server/api-auth";
import { serializeMessage } from "@/server/api-serialize";
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Folder = (typeof folderEnum.enumValues)[number];

/**
 * GET /api/v1/messages — every message, inbound and outbound, flat.
 *
 * Threads are the better way to read a conversation; this is for the times a
 * program wants messages themselves — everything that arrived since a stamp,
 * everything from one sender, everything unread.
 *
 * Filters: `direction`, `folder`, `from`, `to`, `subject`, `q`, `unread`,
 * `starred`, `since`, `until`, `mailbox_id`, `mailbox`, `domain`, `thread_id`.
 */
export const GET = apiRoute("mail:read", async ({ caller, url }) => {
  const mailboxIds = await scopedMailboxIds(caller, url);
  if (mailboxIds.length === 0) return page([], null);

  const limit = limitOf(url);
  const filters = [inArray(message.mailboxId, mailboxIds)];

  const direction = url.searchParams.get("direction");
  const test = testFilter(caller, url);
  if (test) filters.push(test);

  if (direction === "inbound") filters.push(eq(message.isOutbound, false));
  if (direction === "outbound") filters.push(eq(message.isOutbound, true));

  const folder = url.searchParams.get("folder");
  if (folder && folder !== "all") {
    if (!(folderEnum.enumValues as readonly string[]).includes(folder)) {
      return fail(
        "invalid_request",
        `folder must be "all" or one of: ${folderEnum.enumValues.join(", ")}`,
      );
    }
    filters.push(eq(message.folder, folder as Folder));
  }

  const threadId = url.searchParams.get("thread_id");
  if (threadId) filters.push(eq(message.threadId, threadId));

  const drafts = boolOf(url, "drafts");
  if (drafts === false) filters.push(eq(message.isDraft, false));
  if (drafts === true) filters.push(eq(message.isDraft, true));

  const unread = boolOf(url, "unread");
  if (unread !== null) filters.push(eq(message.isRead, !unread));

  const starred = boolOf(url, "starred");
  if (starred !== null) filters.push(eq(message.isStarred, starred));

  const from = url.searchParams.get("from");
  if (from) filters.push(eq(message.fromAddress, from.toLowerCase().trim()));

  const to = url.searchParams.get("to");
  if (to) {
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${message.to}) AS r
        WHERE lower(r->>'address') = ${to.toLowerCase().trim()}
      )`,
    );
  }

  const subject = url.searchParams.get("subject");
  if (subject) filters.push(ilike(message.subject, `%${subject}%`));

  const query = url.searchParams.get("q")?.trim();
  if (query) {
    filters.push(
      or(
        sql`${message.searchVector} @@ websearch_to_tsquery('english', ${query})`,
        ilike(message.subject, `%${query}%`),
        ilike(message.fromAddress, `%${query}%`),
      )!,
    );
  }

  const since = dateOf(url, "since");
  if (since) filters.push(gte(message.receivedAt, since));
  const until = dateOf(url, "until");
  if (until) filters.push(lte(message.receivedAt, until));

  const cursor = splitCursor(url.searchParams.get("next_cursor") ?? url.searchParams.get("cursor"));
  if (cursor) {
    const [stamp, id] = cursor;
    const at = new Date(Number(stamp));
    filters.push(
      or(lt(message.receivedAt, at), and(eq(message.receivedAt, at), lt(message.id, id)))!,
    );
  }

  const rows = await db
    .select({ row: message, address: mailbox.address })
    .from(message)
    .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
    .where(and(...filters))
    .orderBy(desc(message.receivedAt), desc(message.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  const includeBody = boolOf(url, "include_body") ?? false;

  return page(
    items.map((entry) =>
      serializeMessage(entry.row, { mailboxAddress: entry.address, includeBody }),
    ),
    hasMore && last ? makeCursor(last.row.receivedAt, last.row.id) : null,
  );
});
