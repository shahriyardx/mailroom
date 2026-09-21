import { db } from "@/db";
import { mailbox, message, thread } from "@/db/schema";
import { dateOf, fail, ok } from "@/lib/api-http";
import { apiRoute, scopedMailboxIds, testFilter } from "@/server/api-auth";
import { and, gte, inArray, lte, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;

/**
 * GET /api/v1/stats — how much was sent and received, and how it landed.
 *
 * Covers a window ending now: `?days=30` by default, or an explicit `since`
 * and `until`. The reply has both the totals and a row per day, so a chart
 * needs one call rather than one per point.
 *
 * `bounce_rate` and `complaint_rate` are shares of sent mail out of 100. SES
 * starts warning above 5 and 0.1 respectively.
 */
export const GET = apiRoute("stats:read", async ({ caller, url }) => {
  const mailboxIds = await scopedMailboxIds(caller, url);

  const explicitSince = dateOf(url, "since");
  const explicitUntil = dateOf(url, "until");

  const days = Number(url.searchParams.get("days") ?? DEFAULT_DAYS);
  if (!explicitSince && (!Number.isFinite(days) || days <= 0 || days > MAX_DAYS)) {
    return fail("invalid_request", `days must be between 1 and ${MAX_DAYS}`);
  }

  const until = explicitUntil ?? new Date();
  const since = explicitSince ?? new Date(until.getTime() - Math.floor(days) * 24 * 3600 * 1000);

  if (mailboxIds.length === 0) {
    return ok(emptyStats(since, until));
  }

  // Test sends would otherwise show up as real traffic, which is the one
  // thing a bounce rate must never be wrong about.
  const test = testFilter(caller, url);

  const window = and(
    inArray(message.mailboxId, mailboxIds),
    gte(message.createdAt, since),
    lte(message.createdAt, until),
    ...(test ? [test] : []),
  );

  const [[totals], series, [receiving], boxes] = await Promise.all([
    db
      .select({
        sent: sql<number>`count(*) filter (where ${message.isOutbound} and not ${message.isDraft})::int`,
        delivered: sql<number>`count(*) filter (where ${message.deliveryStatus} = 'delivered')::int`,
        bounced: sql<number>`count(*) filter (where ${message.deliveryStatus} = 'bounced')::int`,
        complained: sql<number>`count(*) filter (where ${message.deliveryStatus} = 'complained')::int`,
        failed: sql<number>`count(*) filter (where ${message.deliveryStatus} in ('failed','rejected'))::int`,
        opened: sql<number>`count(*) filter (where ${message.openedAt} is not null)::int`,
        opens: sql<number>`coalesce(sum(${message.openCount}), 0)::int`,
        received: sql<number>`count(*) filter (where not ${message.isOutbound})::int`,
        drafts: sql<number>`count(*) filter (where ${message.isDraft})::int`,
        bytes: sql<number>`coalesce(sum(${message.sizeBytes}), 0)::bigint`,
      })
      .from(message)
      .where(window),

    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${message.createdAt}), 'YYYY-MM-DD')`,
        sent: sql<number>`count(*) filter (where ${message.isOutbound} and not ${message.isDraft})::int`,
        received: sql<number>`count(*) filter (where not ${message.isOutbound})::int`,
        delivered: sql<number>`count(*) filter (where ${message.deliveryStatus} = 'delivered')::int`,
        bounced: sql<number>`count(*) filter (where ${message.deliveryStatus} = 'bounced')::int`,
        opened: sql<number>`count(*) filter (where ${message.openedAt} is not null)::int`,
      })
      .from(message)
      .where(window)
      .groupBy(sql`date_trunc('day', ${message.createdAt})`)
      .orderBy(sql`date_trunc('day', ${message.createdAt})`),

    db
      .select({
        threads: sql<number>`count(*)::int`,
        unread: sql<number>`count(*) filter (where ${thread.unreadCount} > 0)::int`,
      })
      .from(thread)
      .where(inArray(thread.mailboxId, mailboxIds)),

    db
      .select({
        id: mailbox.id,
        address: mailbox.address,
        sent: sql<number>`count(${message.id}) filter (where ${message.isOutbound} and not ${message.isDraft})::int`,
        received: sql<number>`count(${message.id}) filter (where not ${message.isOutbound})::int`,
      })
      .from(mailbox)
      .leftJoin(
        message,
        and(
          sql`${message.mailboxId} = ${mailbox.id}`,
          gte(message.createdAt, since),
          lte(message.createdAt, until),
          ...(test ? [test] : []),
        ),
      )
      .where(inArray(mailbox.id, mailboxIds))
      .groupBy(mailbox.id, mailbox.address)
      .orderBy(sql`count(${message.id}) desc`)
      .limit(50),
  ]);

  const sent = totals?.sent ?? 0;
  const share = (count: number) => (sent === 0 ? 0 : Number(((count / sent) * 100).toFixed(2)));

  return ok({
    object: "stats",
    since,
    until,
    sending: {
      sent,
      delivered: totals?.delivered ?? 0,
      bounced: totals?.bounced ?? 0,
      complained: totals?.complained ?? 0,
      failed: totals?.failed ?? 0,
      opened: totals?.opened ?? 0,
      total_opens: totals?.opens ?? 0,
      bounce_rate: share(totals?.bounced ?? 0),
      complaint_rate: share(totals?.complained ?? 0),
      open_rate: share(totals?.opened ?? 0),
    },
    receiving: {
      received: totals?.received ?? 0,
      threads: receiving?.threads ?? 0,
      unread: receiving?.unread ?? 0,
    },
    drafts: totals?.drafts ?? 0,
    bytes: Number(totals?.bytes ?? 0),
    days: fillGaps(series, since, until),
    mailboxes: boxes,
  });
});

interface DayRow {
  day: string;
  sent: number;
  received: number;
  delivered: number;
  bounced: number;
  opened: number;
}

/** A chart needs a point for every day, including the quiet ones. */
function fillGaps(rows: DayRow[], since: Date, until: Date): DayRow[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const out: DayRow[] = [];

  const cursor = new Date(
    Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()),
  );
  const end = Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate());

  while (cursor.getTime() <= end) {
    const key = cursor.toISOString().slice(0, 10);
    out.push(
      byDay.get(key) ?? { day: key, sent: 0, received: 0, delivered: 0, bounced: 0, opened: 0 },
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function emptyStats(since: Date, until: Date) {
  return {
    object: "stats" as const,
    since,
    until,
    sending: {
      sent: 0,
      delivered: 0,
      bounced: 0,
      complained: 0,
      failed: 0,
      opened: 0,
      total_opens: 0,
      bounce_rate: 0,
      complaint_rate: 0,
      open_rate: 0,
    },
    receiving: { received: 0, threads: 0, unread: 0 },
    drafts: 0,
    bytes: 0,
    days: fillGaps([], since, until),
    mailboxes: [],
  };
}
