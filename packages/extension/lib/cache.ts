import { browser } from "wxt/browser";
import type { Settings } from "./settings";
import type { ApiMailbox, ApiThread, View } from "./types";

/**
 * The last thing each view showed, kept so the next open is not a blank wait.
 *
 * A popup is closed and rebuilt from nothing every single time it is opened:
 * new document, new React tree, no memory of the last one. Fetching before
 * drawing means every open costs a round trip to a server that may be on the
 * other side of the world, and four skeleton rows is what a mail client looks
 * like if you only ever glance at it.
 *
 * So the list is drawn from here first and replaced when the answer arrives.
 * Stale for a second beats empty for a second.
 */

const KEY = "cache";

/** Old enough that showing it without saying so would be a lie. */
const STALE_AFTER = 10 * 60_000;

interface Entry {
  threads: ApiThread[];
  at: number;
}

interface Cache {
  lists: Record<string, Entry>;
  mailboxes?: { rows: ApiMailbox[]; at: number };
}

/** Which mail a cached list is of, so one scope never shows another's. */
export function scopeKey(settings: Settings) {
  return settings.watchAll ? "all" : [...settings.mailboxIds].sort().join(",") || "none";
}

function listKey(settings: Settings, view: View, search: string) {
  // A search is a different question with a different answer, and caching it
  // would mean typing a query and being shown the last one.
  return search.trim() ? "" : `${view}:${scopeKey(settings)}`;
}

async function read(): Promise<Cache> {
  const stored = await browser.storage.local.get(KEY);
  return (stored[KEY] ?? { lists: {} }) as Cache;
}

async function write(cache: Cache) {
  await browser.storage.local.set({ [KEY]: cache });
}

export async function cachedList(
  settings: Settings,
  view: View,
  search: string,
): Promise<{ threads: ApiThread[]; stale: boolean } | null> {
  const key = listKey(settings, view, search);
  if (!key) return null;

  const cache = await read();
  const entry = cache.lists?.[key];
  if (!entry) return null;

  return { threads: entry.threads, stale: Date.now() - entry.at > STALE_AFTER };
}

export async function cacheList(
  settings: Settings,
  view: View,
  search: string,
  threads: ApiThread[],
) {
  const key = listKey(settings, view, search);
  if (!key) return;

  const cache = await read();
  const lists = { ...(cache.lists ?? {}) };
  // One page is what the popup opens on; keeping the "load more" pages would
  // grow this without making any first paint faster.
  lists[key] = { threads: threads.slice(0, 25), at: Date.now() };

  await write({ ...cache, lists });
}

export async function cachedMailboxes(): Promise<ApiMailbox[] | null> {
  const cache = await read();
  return cache.mailboxes?.rows ?? null;
}

export async function cacheMailboxes(rows: ApiMailbox[]) {
  const cache = await read();
  await write({ ...cache, mailboxes: { rows, at: Date.now() } });
}

/** Everything cached is about one instance. A different one shares nothing. */
export async function clearCache() {
  await browser.storage.local.set({ [KEY]: { lists: {} } });
}
