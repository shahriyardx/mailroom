import "server-only";
import { db } from "@/db";
import { attachment, mailbox, message, thread, threadLabel } from "@/db/schema";
import { type Scope, type ViewFolder, isRealFolder } from "@/lib/scope";
import { and, arrayContains, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { resolveScope } from "./mailboxes";

export const PAGE_SIZE = 50;

export interface ThreadListItem {
  id: string;
  mailboxId: string;
  mailboxAddress: string;
  mailboxColor: string;
  domain: string;
  subject: string;
  snippet: string;
  participants: { name: string | null; address: string }[];
  messageCount: number;
  unreadCount: number;
  isStarred: boolean;
  hasAttachments: boolean;
  lastMessageAt: Date;
}

interface ListOptions {
  orgId: string;
  scope: Scope;
  folder: ViewFolder;
  query?: string;
  labelId?: string;
  cursor?: string;
  unreadOnly?: boolean;
}

export async function listThreads(options: ListOptions): Promise<{
  items: ThreadListItem[];
  nextCursor: string | null;
}> {
  const mailboxIds = await resolveScope(options.orgId, options.scope);
  if (mailboxIds.length === 0) return { items: [], nextCursor: null };

  const filters = [inArray(thread.mailboxId, mailboxIds)];

  if (options.folder === "starred") {
    filters.push(eq(thread.isStarred, true));
    // Starred still hides deleted mail, the same way Gmail does.
    filters.push(
      sql`NOT (${thread.folders} @> ARRAY['trash']::folder[] AND array_length(${thread.folders}, 1) = 1)`,
    );
  } else if (isRealFolder(options.folder)) {
    filters.push(arrayContains(thread.folders, [options.folder]));
  }

  if (options.unreadOnly) {
    filters.push(sql`${thread.unreadCount} > 0`);
  }

  if (options.labelId) {
    filters.push(
      sql`EXISTS (SELECT 1 FROM ${threadLabel} tl WHERE tl.thread_id = ${thread.id} AND tl.label_id = ${options.labelId})`,
    );
  }

  const search = options.query?.trim();
  if (search) {
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM ${message} m
        WHERE m.thread_id = ${thread.id}
          AND (
            m.search_vector @@ websearch_to_tsquery('english', ${search})
            OR m.from_address ILIKE ${`%${search}%`}
            OR m.subject ILIKE ${`%${search}%`}
          )
      )`,
    );
  }

  if (options.cursor) {
    const [stamp, id] = options.cursor.split("|");
    filters.push(
      or(
        lt(thread.lastMessageAt, new Date(Number(stamp))),
        and(eq(thread.lastMessageAt, new Date(Number(stamp))), lt(thread.id, id!)),
      )!,
    );
  }

  const rows = await db
    .select({
      id: thread.id,
      mailboxId: thread.mailboxId,
      subject: thread.subject,
      snippet: thread.snippet,
      participants: thread.participants,
      messageCount: thread.messageCount,
      unreadCount: thread.unreadCount,
      isStarred: thread.isStarred,
      hasAttachments: thread.hasAttachments,
      lastMessageAt: thread.lastMessageAt,
      mailboxAddress: mailbox.address,
      mailboxColor: mailbox.color,
      domain: mailbox.domain,
    })
    .from(thread)
    .innerJoin(mailbox, eq(mailbox.id, thread.mailboxId))
    .where(and(...filters))
    .orderBy(desc(thread.lastMessageAt), desc(thread.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = items.at(-1);

  return {
    items,
    nextCursor: hasMore && last ? `${last.lastMessageAt.getTime()}|${last.id}` : null,
  };
}

/** Unread counts per folder for the current scope, for the sidebar badges. */
export async function folderCounts(orgId: string, scope: Scope) {
  const mailboxIds = await resolveScope(orgId, scope);
  const empty = { inbox: 0, starred: 0, sent: 0, drafts: 0, archive: 0, spam: 0, trash: 0 };
  if (mailboxIds.length === 0) return empty;

  const rows = await db
    .select({
      folder: sql<string>`f.folder`,
      unread: sql<number>`count(*) filter (where ${thread.unreadCount} > 0)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(thread)
    .innerJoin(sql`unnest(${thread.folders}) as f(folder)`, sql`true`)
    .where(inArray(thread.mailboxId, mailboxIds))
    .groupBy(sql`f.folder`);

  const counts = { ...empty } as Record<string, number>;
  for (const row of rows) {
    // Drafts show a total, everything else shows unread, like a normal client.
    counts[row.folder] = row.folder === "drafts" ? row.total : row.unread;
  }

  const [starred] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(thread)
    .where(and(inArray(thread.mailboxId, mailboxIds), eq(thread.isStarred, true)));
  counts.starred = starred?.total ?? 0;

  return counts as typeof empty;
}

/** Per-mailbox unread inbox counts, shown next to each address in the sidebar. */
export async function unreadByMailbox(orgId: string) {
  const mailboxIds = await resolveScope(orgId, { kind: "all" });
  if (mailboxIds.length === 0) return {} as Record<string, number>;

  const rows = await db
    .select({ mailboxId: thread.mailboxId, unread: sql<number>`count(*)::int` })
    .from(thread)
    .where(
      and(
        inArray(thread.mailboxId, mailboxIds),
        arrayContains(thread.folders, ["inbox"]),
        sql`${thread.unreadCount} > 0`,
      ),
    )
    .groupBy(thread.mailboxId);

  return Object.fromEntries(rows.map((row) => [row.mailboxId, row.unread]));
}

export async function getThreadDetail(orgId: string, threadId: string) {
  const mailboxIds = await resolveScope(orgId, { kind: "all" });
  if (mailboxIds.length === 0) return null;

  const row = await db.query.thread.findFirst({
    where: and(eq(thread.id, threadId), inArray(thread.mailboxId, mailboxIds)),
    with: {
      mailbox: true,
      messages: {
        orderBy: (m, { asc }) => [asc(m.receivedAt)],
        with: { attachments: true },
      },
      labels: { with: { label: true } },
    },
  });

  return row ?? null;
}

export async function getAttachmentForUser(orgId: string, attachmentId: string) {
  const mailboxIds = await resolveScope(orgId, { kind: "all" });
  if (mailboxIds.length === 0) return null;

  const [row] = await db
    .select({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      r2Key: attachment.r2Key,
    })
    .from(attachment)
    .innerJoin(message, eq(message.id, attachment.messageId))
    .where(and(eq(attachment.id, attachmentId), inArray(message.mailboxId, mailboxIds)))
    .limit(1);

  return row ?? null;
}
