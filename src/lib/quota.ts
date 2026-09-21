import type { AccountStatus } from "@/lib/ses";

/**
 * Reading the SES sending quota.
 *
 * Two things about it catch people out, so they are handled here once rather
 * than in each panel that shows the numbers.
 *
 * The 24-hour figure is a *rolling* window, not a daily allowance. SES counts
 * what was sent in the last 24 hours, and each send stops counting 24 hours
 * after it happened. There is no midnight, and nothing to count down to — the
 * headroom comes back gradually as old sends age out.
 *
 * And an account with no cap reports -1, which reads as a nonsense number if
 * it is printed as one.
 */

/** SES reports no cap as -1 rather than as a large number or null. */
export const UNLIMITED = -1;

export interface Quota {
  used: number;
  /** Null when the account has no 24-hour cap. */
  cap: number | null;
  /** 0-100, or null when there is no cap to be a share of. */
  percent: number | null;
  /** True once the account is close enough that it is worth saying so. */
  tight: boolean;
  perSecond: number;
}

/** Where the account stands, in the terms a panel wants to show. */
export function readQuota(account: AccountStatus): Quota {
  const cap = account.max24Hour === UNLIMITED || account.max24Hour <= 0 ? null : account.max24Hour;
  const used = Math.max(0, account.sentLast24Hours);
  const percent = cap === null ? null : Math.min(100, (used / cap) * 100);

  return {
    used,
    cap,
    percent,
    // Below this there is nothing useful to say: the headroom is not the
    // thing anybody is worried about.
    tight: percent !== null && percent >= 80,
    perSecond: account.maxSendRate,
  };
}

/** "50,000" or "no limit". */
export function formatCap(cap: number | null) {
  return cap === null ? "no limit" : cap.toLocaleString();
}

/** A rate that may be fractional on a new account. */
export function formatRate(perSecond: number) {
  return Number.isInteger(perSecond) ? String(perSecond) : perSecond.toFixed(1);
}

/** "3h 12m", "12m", or "any moment now". */
export function formatGap(ms: number) {
  if (ms <= 60_000) return "any moment now";
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** When the send at this time stops counting against the 24-hour window. */
export function agesOutAt(sentAt: Date) {
  return new Date(sentAt.getTime() + 24 * 60 * 60 * 1000);
}
