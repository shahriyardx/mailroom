import "server-only";

import { db } from "@/db";
import { apiKey, attachment, mailbox, message, messageEvent } from "@/db/schema";
import type { Direction, LogRow } from "@/lib/log-view";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

// Re-exported so a server caller need not know where they live.
export { DAY_RANGES, SENDING_STATUSES } from "@/lib/log-view";
export type { Direction, LogRow } from "@/lib/log-view";
import { listMailboxesFor } from "./mailboxes";

export interface LogAccess {
  orgId: string;
  isRoot: boolean;
  memberId: string;
  teamIds: string[];
}

export interface LogFilters {
  direction: Direction;
  /** Matches the address, the subject, or the SES id. */
  q?: string;
  status?: string;
  /** How far back to look. 0 means everything. */
  days?: number;
  keyId?: string;
  /** Test sends are hidden unless asked for, the same as everywhere else. */
  test?: boolean;
  cursor?: string;
  limit?: number;
}

const PAGE = 50;

/** The mailboxes this person may read, as ids. Empty means show nothing. */
async function scope(access: LogAccess) {
  const boxes = await listMailboxesFor(access);
  return boxes.map((box) => box.id);
}

/**
 * One page of the log.
 *
 * Ordered newest first and paged on (timestamp, id) rather than an offset:
 * a log grows at the top while it is being read, and an offset would show
 * the same row twice.
 */
export async function listLog(access: LogAccess, filters: LogFilters) {
  const ids = await scope(access);
  if (ids.length === 0) return { rows: [] as LogRow[], nextCursor: null as string | null };

  const outbound = filters.direction === "sending";
  const limit = filters.limit ?? PAGE;
  // A sent message is ordered by when it went out; a received one by when it
  // arrived. Kept as an SQL fragment either way so the two paths are one.
  const when = outbound
    ? sql`coalesce(${message.sentAt}, ${message.receivedAt})`
    : sql`${message.receivedAt}`;

  const where = [
    inArray(message.mailboxId, ids),
    eq(message.isOutbound, outbound),
    eq(message.isDraft, false),
    eq(message.isTest, filters.test === true),
  ];

  if (filters.days && filters.days > 0) {
    // Written out rather than gte(): drizzle turns a Date into a timestamp
    // only when it knows the column type, and `when` is an expression with
    // none — the Date would reach the driver raw and be refused.
    const cutoff = new Date(Date.now() - filters.days * 86_400_000).toISOString();
    where.push(sql`${when} >= ${cutoff}::timestamptz`);
  }
  if (filters.status) {
    where.push(eq(message.deliveryStatus, filters.status as never));
  }
  if (filters.keyId) {
    where.push(eq(message.apiKeyId, filters.keyId));
  }
  if (filters.q?.trim()) {
    const like = `%${filters.q.trim()}%`;
    where.push(
      or(
        ilike(message.subject, like),
        ilike(message.fromAddress, like),
        ilike(message.sesMessageId, like),
        sql`exists (select 1 from jsonb_array_elements(${message.to}) as r where r->>'address' ilike ${like})`,
      )!,
    );
  }
  if (filters.cursor) {
    const [stamp, id] = filters.cursor.split("|");
    const at = new Date(Number(stamp));
    if (!Number.isNaN(at.getTime()) && id) {
      const mark = at.toISOString();
      where.push(
        sql`(${when} < ${mark}::timestamptz or (${when} = ${mark}::timestamptz and ${message.id} > ${id}))`,
      );
    }
  }

  const rows = await db
    .select({
      id: message.id,
      threadId: message.threadId,
      subject: message.subject,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      to: message.to,
      deliveryStatus: message.deliveryStatus,
      deliveryError: message.deliveryError,
      isTest: message.isTest,
      openCount: message.openCount,
      at: sql<Date>`${when}`.as("at"),
      mailbox: mailbox.address,
      mailboxColor: mailbox.color,
    })
    .from(message)
    .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
    .where(and(...where))
    .orderBy(desc(sql`at`), asc(message.id))
    .limit(limit + 1);

  const more = rows.length > limit;
  const page = (more ? rows.slice(0, limit) : rows) as LogRow[];
  const last = page.at(-1);

  return {
    rows: page,
    nextCursor: more && last ? `${new Date(last.at).getTime()}|${last.id}` : null,
  };
}

/** Every API key in the account, so the log can be filtered down to one. */
export async function logKeys(orgId: string) {
  return db
    .select({ id: apiKey.id, name: apiKey.name, mode: apiKey.mode })
    .from(apiKey)
    .where(eq(apiKey.organizationId, orgId))
    .orderBy(desc(apiKey.createdAt));
}

/** One message, with everything that has happened to it since. */
export async function logEntry(access: LogAccess, id: string) {
  const ids = await scope(access);
  if (ids.length === 0) return null;

  const [row] = await db
    .select({
      message,
      mailboxAddress: mailbox.address,
      mailboxName: mailbox.displayName,
      mailboxColor: mailbox.color,
    })
    .from(message)
    .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
    .where(and(eq(message.id, id), inArray(message.mailboxId, ids)))
    .limit(1);

  if (!row) return null;

  const [events, files, key] = await Promise.all([
    db
      .select()
      .from(messageEvent)
      .where(
        row.message.sesMessageId
          ? or(
              eq(messageEvent.messageId, row.message.id),
              eq(messageEvent.sesMessageId, row.message.sesMessageId),
            )
          : eq(messageEvent.messageId, row.message.id),
      )
      .orderBy(asc(messageEvent.occurredAt)),
    db.select().from(attachment).where(eq(attachment.messageId, row.message.id)),
    row.message.apiKeyId
      ? db
          .select({ id: apiKey.id, name: apiKey.name, mode: apiKey.mode })
          .from(apiKey)
          .where(eq(apiKey.id, row.message.apiKeyId))
          .limit(1)
          .then((found) => found[0] ?? null)
      : Promise.resolve(null),
  ]);

  return { ...row, events, attachments: files, apiKey: key };
}
