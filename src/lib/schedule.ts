/**
 * Reading "when should this go out" from whatever the caller wrote.
 *
 * An ISO timestamp is the form a program produces and the one the API
 * documents. The relative form is here because the thing people actually want
 * to say is "in ten minutes", and making them compute a timestamp to say it
 * is how you get off-by-one-timezone bugs in somebody else's code.
 */

/** As far ahead as a message may be held. Beyond this it is a reminder, not an email. */
export const MAX_SCHEDULE_DAYS = 30;

const RELATIVE = /^in\s+(\d+)\s*(second|minute|hour|day|min|sec|hr|s|m|h|d)s?$/i;

const UNIT_MS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  second: 1000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
};

export type ScheduleResult = { at: Date } | { error: string };

export function parseSchedule(value: string | number | Date, now = Date.now()): ScheduleResult {
  const at = toDate(value, now);
  if (!at) {
    return {
      error:
        'scheduled_at must be an ISO 8601 time such as "2026-10-01T09:00:00Z", or a relative one such as "in 30 minutes"',
    };
  }

  const limit = now + MAX_SCHEDULE_DAYS * 86_400_000;
  if (at.getTime() > limit) {
    return { error: `scheduled_at cannot be more than ${MAX_SCHEDULE_DAYS} days from now` };
  }

  return { at };
}

function toDate(value: string | number | Date, now: number): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === "number") {
    // Seconds and milliseconds are both in circulation. Anything below this is
    // 1970 in milliseconds, which nobody means, and 2001 in seconds.
    const ms = value < 100_000_000_000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = value.trim();
  if (!text) return null;

  const relative = RELATIVE.exec(text);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = UNIT_MS[relative[2]?.toLowerCase() ?? ""];
    if (!Number.isFinite(amount) || !unit) return null;
    return new Date(now + amount * unit);
  }

  if (/^\d+$/.test(text)) return toDate(Number(text), now);

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Whether a time is far enough ahead to be worth holding the message for.
 *
 * A send scheduled for a moment ago is a send, not a schedule, and queuing it
 * only to pick it up on the next pass would add fifteen seconds for nothing.
 */
export function isFutureSchedule(at: Date, now = Date.now()) {
  return at.getTime() > now;
}
