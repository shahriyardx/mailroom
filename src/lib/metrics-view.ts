/**
 * The shape of the metrics screen, shared by the query that fills it and the
 * component that draws it.
 *
 * Its own module because the query is server-only and the chart is a client
 * component: a constant either of them owns is a constant the other cannot
 * import.
 */

/** How far back the screen may look, in days. */
export const RANGES = [7, 15, 30, 90] as const;
export type Range = (typeof RANGES)[number];

export const DEFAULT_RANGE: Range = 15;

export interface DayBucket {
  /** `YYYY-MM-DD`, in UTC. */
  day: string;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  opened: number;
}

export interface Totals {
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  opened: number;
}

/** One kind of bounce or complaint, as SES names it. */
export interface BounceKind {
  kind: string;
  howMany: number;
  /** Of everything sent in the range, as a percentage. */
  rate: number;
}

export interface MetricsView {
  days: DayBucket[];
  totals: Totals;
  /** Percentages, or null when nothing was sent and a rate would be a lie. */
  deliverability: number | null;
  bounceRate: number | null;
  complaintRate: number | null;
  openRate: number | null;
  bounces: BounceKind[];
  complaints: BounceKind[];
  /** Every domain this person may see, for the filter. */
  domains: { id: string; name: string }[];
  range: number;
  domainId: string | null;
}

/**
 * The share one count is of another, as a percentage with two decimals.
 *
 * Two decimals rather than none because the numbers that matter here are
 * small: SES starts asking questions at a 5% bounce rate and 0.1% complaints,
 * and a complaint rate rounded to whole percent reads 0% right up to the
 * point the account is suspended.
 */
export function share(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 10_000) / 100;
}

/** `YYYY-MM-DD` for a moment, in UTC. */
export function dayKey(at: Date) {
  return at.toISOString().slice(0, 10);
}

/**
 * Every day in the range, oldest first, including the ones nothing happened
 * on. A chart that skips empty days draws a busy week and a quiet week the
 * same width, which is the one thing it is there to tell apart.
 */
export function emptyDays(range: number, now = Date.now()): Map<string, DayBucket> {
  const out = new Map<string, DayBucket>();
  for (let back = range - 1; back >= 0; back--) {
    const day = dayKey(new Date(now - back * 86_400_000));
    out.set(day, { day, sent: 0, delivered: 0, bounced: 0, complained: 0, opened: 0 });
  }
  return out;
}

/** The asked-for range if it is one we offer, and the default otherwise. */
export function readRange(value: string | number | null | undefined): Range {
  const asked = Number(value);
  return (RANGES as readonly number[]).includes(asked) ? (asked as Range) : DEFAULT_RANGE;
}

/** Totals for a set of days, which is the only way the headline figures exist. */
export function sumDays(days: DayBucket[]): Totals {
  return days.reduce<Totals>(
    (sum, day) => ({
      sent: sum.sent + day.sent,
      delivered: sum.delivered + day.delivered,
      bounced: sum.bounced + day.bounced,
      complained: sum.complained + day.complained,
      opened: sum.opened + day.opened,
    }),
    { sent: 0, delivered: 0, bounced: 0, complained: 0, opened: 0 },
  );
}
