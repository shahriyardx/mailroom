import "server-only";

import { db } from "@/db";
import { domain, mailbox, message, messageEvent } from "@/db/schema";
import { type MetricsView, emptyDays, readRange, share, sumDays } from "@/lib/metrics-view";
import { and, eq, inArray, sql } from "drizzle-orm";
import { listMailboxesFor } from "./mailboxes";

// Re-exported so a server caller need not know where they live.
export { RANGES, DEFAULT_RANGE, readRange } from "@/lib/metrics-view";
export type { BounceKind, DayBucket, MetricsView, Range, Totals } from "@/lib/metrics-view";

/**
 * What sending has actually been doing.
 *
 * The email log answers "what happened to this message". This answers the
 * other half — whether the account as a whole is healthy — which is a shape
 * no list of rows shows: a bounce rate means nothing without the volume it
 * sits on, or the direction it is moving in.
 *
 * Everything is read straight from `message` and `message_event`. There is no
 * rollup table: an instance that has to summarise a day of its own mail before
 * it can draw a chart is an instance with a second source of truth to keep in
 * step, and one grouped scan is cheap at the sizes this runs at.
 */

export interface MetricsAccess {
  orgId: string;
  isRoot: boolean;
  memberId: string;
  teamIds: string[];
}

const DAY = 86_400_000;

/** The mailboxes this person may read. Empty means show nothing. */
async function scope(access: MetricsAccess) {
  const boxes = await listMailboxesFor(access);
  return boxes.map((box) => box.id);
}

function empty(range: number, domainId: string | null): MetricsView {
  return {
    days: [...emptyDays(range).values()],
    totals: { sent: 0, delivered: 0, bounced: 0, complained: 0, opened: 0 },
    deliverability: null,
    bounceRate: null,
    complaintRate: null,
    openRate: null,
    bounces: [],
    complaints: [],
    domains: [],
    range,
    domainId,
  };
}

export async function metricsView(
  access: MetricsAccess,
  filters: { range?: string | number | null; domainId?: string | null } = {},
): Promise<MetricsView> {
  const range = readRange(filters.range);
  const domainId = filters.domainId ?? null;

  const ids = await scope(access);
  if (ids.length === 0) return empty(range, domainId);

  // The moment the oldest bucket opens. Sending is measured from when the
  // message went out, falling back to when the row was made for anything
  // still queued.
  const from = new Date(Date.now() - (range - 1) * DAY);
  from.setUTCHours(0, 0, 0, 0);
  const cutoff = from.toISOString();

  const when = sql`coalesce(${message.sentAt}, ${message.createdAt})`;

  const where = [
    inArray(message.mailboxId, ids),
    eq(message.isOutbound, true),
    eq(message.isDraft, false),
    // Test sends never reach SES, so counting them would make every rate on
    // this screen a rate of something that did not happen.
    eq(message.isTest, false),
    sql`${when} >= ${cutoff}::timestamptz`,
  ];
  if (domainId) where.push(eq(mailbox.domainId, domainId));

  const day = sql<string>`to_char(date_trunc('day', ${when} at time zone 'UTC'), 'YYYY-MM-DD')`;

  const [rows, bounceRows, complaintRows, domainRows] = await Promise.all([
    db
      .select({
        day: day.as("day"),
        sent: sql<number>`count(*)::int`,
        // A complaint can only follow a delivery, and a message that drew one
        // carries "complained" rather than "delivered" — so it counts as both,
        // or the deliverability rate falls every time somebody presses the
        // spam button.
        delivered: sql<number>`count(*) filter (where ${message.deliveryStatus} in ('delivered', 'complained'))::int`,
        bounced: sql<number>`count(*) filter (where ${message.deliveryStatus} = 'bounced')::int`,
        complained: sql<number>`count(*) filter (where ${message.deliveryStatus} = 'complained')::int`,
        opened: sql<number>`count(*) filter (where ${message.openedAt} is not null)::int`,
      })
      .from(message)
      .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
      .where(and(...where))
      .groupBy(sql`1`),

    // SES writes a bounce as "Permanent/General". Only the first half is worth
    // splitting on: the subtypes are a long tail nobody acts on differently.
    db
      .select({
        kind: sql<string>`coalesce(nullif(split_part(${messageEvent.detail}, '/', 1), ''), 'Undetermined')`.as(
          "kind",
        ),
        howMany: sql<number>`count(*)::int`,
      })
      .from(messageEvent)
      .innerJoin(message, eq(message.id, messageEvent.messageId))
      .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
      .where(and(eq(messageEvent.type, "bounce"), ...where))
      .groupBy(sql`1`),

    db
      .select({
        kind: sql<string>`coalesce(nullif(${messageEvent.detail}, ''), 'Complained')`.as("kind"),
        howMany: sql<number>`count(*)::int`,
      })
      .from(messageEvent)
      .innerJoin(message, eq(message.id, messageEvent.messageId))
      .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
      .where(and(eq(messageEvent.type, "complaint"), ...where))
      .groupBy(sql`1`),

    db
      .selectDistinct({ id: domain.id, name: domain.name })
      .from(domain)
      .innerJoin(mailbox, eq(mailbox.domainId, domain.id))
      .where(inArray(mailbox.id, ids))
      .orderBy(domain.name),
  ]);

  const buckets = emptyDays(range);
  for (const row of rows) {
    // A day that rolled over between building the buckets and reading the
    // rows lands outside the window. Drop it rather than grow the chart.
    const bucket = buckets.get(row.day);
    if (bucket) Object.assign(bucket, row);
  }

  const days = [...buckets.values()];
  const totals = sumDays(days);

  const rated = (list: { kind: string; howMany: number }[]) =>
    list
      .map((row) => ({ ...row, rate: share(row.howMany, totals.sent) ?? 0 }))
      .sort((a, b) => b.howMany - a.howMany);

  return {
    days,
    totals,
    deliverability: share(totals.delivered, totals.sent),
    bounceRate: share(totals.bounced, totals.sent),
    complaintRate: share(totals.complained, totals.sent),
    openRate: share(totals.opened, totals.delivered),
    bounces: rated(bounceRows),
    complaints: rated(complaintRows),
    domains: domainRows,
    range,
    domainId,
  };
}
