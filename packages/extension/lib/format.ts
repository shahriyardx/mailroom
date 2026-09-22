import type { Address, ApiThread } from "./types";

/**
 * The small presentational decisions, kept out of the components.
 *
 * The avatar hues and the initials rule match src/components/kit/avatar.tsx
 * on purpose: the same sender must look the same in the toolbar as in the tab
 * next to it, or the popup reads as a different product.
 */

const HUES = [12, 42, 78, 112, 152, 185, 215, 245, 278, 305, 330, 352];

export function hueFor(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return HUES[hash % HUES.length] as number;
}

export function initialsFor(name?: string | null, address?: string | null) {
  const source = (name ?? "").trim() || (address ?? "").split("@")[0] || "?";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] as string).slice(0, 2).toUpperCase();
  const first = words[0] as string;
  const last = words[words.length - 1] as string;
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

/** A person, as short as it can be while still naming them. */
export function displayName(entry: Address | null | undefined) {
  if (!entry) return "Unknown";
  return entry.name?.trim() || entry.address.split("@")[0] || entry.address;
}

export function formatAddress(entry: Address) {
  return entry.name?.trim() ? `${entry.name} <${entry.address}>` : entry.address;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A timestamp the way a mail client writes one: a clock time today, a weekday
 * this week, a date before that. Never "3 days ago", which asks the reader to
 * do arithmetic to find out when something actually happened.
 */
export function shortTime(value: string | Date, now = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";

  const gap = now.getTime() - date.getTime();

  if (gap < MINUTE) return "now";
  if (gap < HOUR) return `${Math.floor(gap / MINUTE)}m`;
  if (sameDay(date, now)) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (gap < 6 * DAY) return date.toLocaleDateString(undefined, { weekday: "short" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}

/** The long form, for a message header and a tooltip. */
export function fullTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Who a row is about.
 *
 * In the inbox that is whoever wrote in; in Sent it is who it went to. Using
 * the participant list either way would label every sent message with your
 * own address, which tells the reader nothing.
 */
export function rowPerson(thread: ApiThread, view: string): Address {
  const people = thread.participants ?? [];
  const chosen = view === "sent" ? people[people.length - 1] : people[0];
  return chosen ?? { name: null, address: thread.mailbox ?? "unknown" };
}

export function threadSubject(thread: ApiThread) {
  return thread.subject?.trim() || "(no subject)";
}

/** Joins class names, skipping anything falsy. Small enough not to be a dep. */
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
