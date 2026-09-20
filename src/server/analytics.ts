import "server-only";

import { db } from "@/db";
import { sql } from "drizzle-orm";

export interface DayPoint {
  day: string;
  sent: number;
  received: number;
}

export interface MailboxUsage {
  id: string;
  address: string;
  color: string;
  sent: number;
  received: number;
  bytes: number;
}

export interface KeyUsage {
  id: string;
  name: string;
  prefix: string;
  revoked: boolean;
  lastUsedAt: Date | null;
  sent: number;
}

export interface Overview {
  /** Rolling 30 days, one row per day, oldest first. Days with no mail included. */
  days: DayPoint[];
  sending: {
    sent: number;
    delivered: number;
    bounced: number;
    complained: number;
    failed: number;
    pending: number;
    /** Share of sent mail, 0-100. SES starts worrying above 5 and 0.1. */
    bounceRate: number;
    complaintRate: number;
  };
  receiving: { received: number; threads: number; unread: number };
  storage: {
    attachmentBytes: number;
    attachmentCount: number;
    rawBytes: number;
    rawCount: number;
  };
  mailboxes: MailboxUsage[];
  keys: KeyUsage[];
  api: { sent: number; activeKeys: number };
  counts: { mailboxes: number; domains: number; verifiedDomains: number; blocked: number };
}

const WINDOW = 30;

/**
 * Everything the overview shows, in one pass. Each query is scoped through
 * the mailbox table, which is what ties any of this to a user.
 */
export async function overview(userId: string): Promise<Overview> {
  const [daily, delivery, receiving, storage, boxes, keys, counts] = await Promise.all([
    db.execute(sql`
      select to_char(date_trunc('day', m.received_at), 'YYYY-MM-DD') as day,
             count(*) filter (where m.is_outbound) as sent,
             count(*) filter (where not m.is_outbound) as received
        from message m
        join mailbox b on b.id = m.mailbox_id
       where b.user_id = ${userId}
         and not m.is_draft
         and m.received_at > now() - ${`${WINDOW} days`}::interval
       group by 1
       order by 1
    `),
    db.execute(sql`
      select coalesce(m.delivery_status::text, 'pending') as status, count(*) as total
        from message m
        join mailbox b on b.id = m.mailbox_id
       where b.user_id = ${userId}
         and m.is_outbound
         and not m.is_draft
         and m.received_at > now() - ${`${WINDOW} days`}::interval
       group by 1
    `),
    db.execute(sql`
      select count(*) filter (where not m.is_outbound and not m.is_draft) as received,
             count(distinct m.thread_id) as threads,
             count(*) filter (where not m.is_read and not m.is_outbound) as unread
        from message m
        join mailbox b on b.id = m.mailbox_id
       where b.user_id = ${userId}
         and m.received_at > now() - ${`${WINDOW} days`}::interval
    `),
    db.execute(sql`
      select (select coalesce(sum(a.size_bytes), 0)
                from attachment a
                left join message m on m.id = a.message_id
                left join mailbox b on b.id = m.mailbox_id
               where b.user_id = ${userId} or a.uploaded_by = ${userId}) as attachment_bytes,
             (select count(*)
                from attachment a
                left join message m on m.id = a.message_id
                left join mailbox b on b.id = m.mailbox_id
               where b.user_id = ${userId} or a.uploaded_by = ${userId}) as attachment_count,
             (select coalesce(sum(m.size_bytes), 0)
                from message m
                join mailbox b on b.id = m.mailbox_id
               where b.user_id = ${userId} and m.raw_key is not null) as raw_bytes,
             (select count(*)
                from message m
                join mailbox b on b.id = m.mailbox_id
               where b.user_id = ${userId} and m.raw_key is not null) as raw_count
    `),
    db.execute(sql`
      select b.id, b.address, b.color,
             count(m.id) filter (where m.is_outbound and not m.is_draft) as sent,
             count(m.id) filter (where not m.is_outbound and not m.is_draft) as received,
             coalesce(sum(a.size_bytes), 0) as bytes
        from mailbox b
        left join message m on m.mailbox_id = b.id
        left join attachment a on a.message_id = m.id
       where b.user_id = ${userId}
       group by b.id, b.address, b.color
       order by received desc, sent desc
    `),
    db.execute(sql`
      select k.id, k.name, k.prefix, k.revoked_at, k.last_used_at,
             count(m.id) as sent
        from api_key k
        left join message m
               on m.api_key_id = k.id
              and m.received_at > now() - ${`${WINDOW} days`}::interval
       where k.user_id = ${userId}
       group by k.id, k.name, k.prefix, k.revoked_at, k.last_used_at
       order by sent desc, k.created_at desc
    `),
    db.execute(sql`
      select (select count(*) from mailbox where user_id = ${userId}) as mailboxes,
             (select count(*) from domain where user_id = ${userId}) as domains,
             (select count(*) from domain
               where user_id = ${userId} and status = 'verified' and sending_enabled) as verified,
             (select count(*) from suppression where user_id = ${userId}) as blocked
    `),
  ]);

  const byDay = new Map<string, { sent: number; received: number }>();
  for (const row of daily as unknown as Record<string, unknown>[]) {
    byDay.set(String(row.day), {
      sent: Number(row.sent ?? 0),
      received: Number(row.received ?? 0),
    });
  }

  // A gap in the data is still a day, and a chart that skips it lies.
  const days: DayPoint[] = [];
  const today = new Date();
  for (let back = WINDOW - 1; back >= 0; back -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - back);
    const key = date.toISOString().slice(0, 10);
    days.push({ day: key, ...(byDay.get(key) ?? { sent: 0, received: 0 }) });
  }

  const status = new Map<string, number>();
  for (const row of delivery as unknown as Record<string, unknown>[]) {
    status.set(String(row.status), Number(row.total ?? 0));
  }
  const pick = (...names: string[]) =>
    names.reduce((sum, name) => sum + (status.get(name) ?? 0), 0);

  const sent = [...status.values()].reduce((sum, value) => sum + value, 0);
  const bounced = pick("bounced");
  const complained = pick("complained");

  const receivingRow = (receiving as unknown as Record<string, unknown>[])[0] ?? {};
  const storageRow = (storage as unknown as Record<string, unknown>[])[0] ?? {};
  const countsRow = (counts as unknown as Record<string, unknown>[])[0] ?? {};

  const keyRows = (keys as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    prefix: String(row.prefix),
    revoked: row.revoked_at !== null,
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)) : null,
    sent: Number(row.sent ?? 0),
  }));

  return {
    days,
    sending: {
      sent,
      delivered: pick("delivered"),
      bounced,
      complained,
      failed: pick("failed", "rejected"),
      pending: pick("pending", "queued", "sent", "delayed"),
      bounceRate: sent ? (bounced / sent) * 100 : 0,
      complaintRate: sent ? (complained / sent) * 100 : 0,
    },
    receiving: {
      received: Number(receivingRow.received ?? 0),
      threads: Number(receivingRow.threads ?? 0),
      unread: Number(receivingRow.unread ?? 0),
    },
    storage: {
      attachmentBytes: Number(storageRow.attachment_bytes ?? 0),
      attachmentCount: Number(storageRow.attachment_count ?? 0),
      rawBytes: Number(storageRow.raw_bytes ?? 0),
      rawCount: Number(storageRow.raw_count ?? 0),
    },
    mailboxes: (boxes as unknown as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      address: String(row.address),
      color: String(row.color),
      sent: Number(row.sent ?? 0),
      received: Number(row.received ?? 0),
      bytes: Number(row.bytes ?? 0),
    })),
    keys: keyRows,
    api: {
      sent: keyRows.reduce((sum, key) => sum + key.sent, 0),
      activeKeys: keyRows.filter((key) => !key.revoked).length,
    },
    counts: {
      mailboxes: Number(countsRow.mailboxes ?? 0),
      domains: Number(countsRow.domains ?? 0),
      verifiedDomains: Number(countsRow.verified ?? 0),
      blocked: Number(countsRow.blocked ?? 0),
    },
  };
}

export const OVERVIEW_WINDOW_DAYS = WINDOW;
