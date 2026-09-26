import type { SendWindow } from "@/db/schema";

/**
 * Whether an automation may send right now, and when it next may.
 *
 * Worked out in the automation's own time zone rather than the server's: a
 * window of nine to five means nine to five where the readers are, and the
 * server is usually in UTC somewhere else entirely.
 */

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Weekdays, nine to five, in the given zone. What a new window starts as. */
export function defaultWindow(timeZone: string): SendWindow {
  return { from: 9, to: 17, days: [1, 2, 3, 4, 5], timeZone };
}

/** Whether this names a time zone the runtime knows. */
export function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The day and hour at an instant, in a time zone.
 *
 * Read off `Intl` rather than worked out from an offset, because an offset
 * changes twice a year and the rules for when differ by country.
 */
function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  return { day: Math.max(0, DAY_NAMES.indexOf(weekday as (typeof DAY_NAMES)[number])), hour };
}

/** Whether the window is open at this instant. */
export function inWindow(window: SendWindow | null, at: Date = new Date()) {
  if (!window) return true;
  const { day, hour } = localParts(at, window.timeZone);

  // The same hour at both ends is a slip, and treated as all day rather
  // than as never — a window that never opens would hold everybody forever.
  if (window.from === window.to) return window.days.includes(day);

  if (window.from < window.to) {
    return window.days.includes(day) && hour >= window.from && hour < window.to;
  }

  /*
   * Over midnight: ten at night until six. The hours after midnight belong
   * to the day the window opened on, so a Friday-only window still sends at
   * two on Saturday morning.
   */
  if (hour >= window.from) return window.days.includes(day);
  if (hour < window.to) return window.days.includes((day + 6) % 7);
  return false;
}

/** Steps a quarter of an hour at a time: every time zone in use changes on one. */
const STEP_MS = 15 * 60_000;
/** Longer than any window can stay shut, with room for a daylight-saving change. */
const HORIZON_MS = 8 * 86_400_000;

/**
 * The next instant the window is open, or `at` itself when it already is.
 *
 * Found by stepping forward rather than by arithmetic. The arithmetic has to
 * know about daylight saving, midnight windows and skipped days all at once,
 * and a loop over at most eight days of quarter hours is too cheap to be
 * worth getting that wrong.
 */
export function nextOpening(window: SendWindow | null, at: Date = new Date()): Date {
  if (!window || inWindow(window, at)) return at;
  // No day ticked means never; an hour from now is asked again instead of
  // holding anybody forever.
  if (window.days.length === 0) return new Date(at.getTime() + 3_600_000);

  let probe = Math.ceil(at.getTime() / STEP_MS) * STEP_MS;
  const stop = at.getTime() + HORIZON_MS;
  while (probe <= stop) {
    if (inWindow(window, new Date(probe))) return new Date(probe);
    probe += STEP_MS;
  }
  return new Date(at.getTime() + 3_600_000);
}

/** "9:00 – 17:00, Mon–Fri (Europe/London)", for a card or a note. */
export function describeWindow(window: SendWindow | null) {
  if (!window) return "Any time";
  const hours = `${pad(window.from)} – ${pad(window.to)}`;
  return `${hours}, ${describeDays(window.days)} (${window.timeZone})`;
}

function pad(hour: number) {
  return `${String(hour % 24).padStart(2, "0")}:00`;
}

function describeDays(days: number[]) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "every day";
  if (sorted.join() === "1,2,3,4,5") return "Mon–Fri";
  if (sorted.join() === "0,6") return "weekends";
  return sorted.map((day) => DAY_NAMES[day]).join(", ");
}
