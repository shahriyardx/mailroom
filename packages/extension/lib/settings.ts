import { browser } from "wxt/browser";

/**
 * What the reader told us once, kept in this browser.
 *
 * `storage.local` and not `storage.sync`: the API key is a credential, and
 * sync would copy it to every machine signed into the browser profile —
 * including ones the reader never meant to read mail on.
 */
export interface Settings {
  /** Origin of the Mailroom instance, no trailing slash. */
  baseUrl: string;
  apiKey: string;
  /**
   * Every address the key reaches, including ones added later.
   *
   * A separate answer from the list below, and not a shorthand for a full
   * one: "all of them, whatever they turn out to be" and "these six" look the
   * same on the day they are chosen and differ on the day a seventh address
   * is made. An empty list with this off means none, which is a choice
   * somebody is allowed to make.
   */
  watchAll: boolean;
  /** The addresses to watch when `watchAll` is off. */
  mailboxIds: string[];
  notifications: boolean;
  /** How often the background asks for new mail. Minutes. */
  pollMinutes: number;
  /** Play the browser's notification sound is the browser's business; this
   *  only decides whether the toolbar number is drawn. */
  badge: boolean;
  theme: "system" | "light" | "dark";
}

export const DEFAULTS: Settings = {
  baseUrl: "",
  apiKey: "",
  watchAll: true,
  mailboxIds: [],
  notifications: true,
  pollMinutes: 2,
  badge: true,
  theme: "system",
};

const KEY = "settings";

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY);
  const value = (stored[KEY] ?? {}) as Partial<Settings>;

  // Written before `watchAll` existed, when a non-empty list was the only way
  // to say "just these". Defaulting it to true would silently widen what a
  // reader had narrowed.
  const watchAll = value.watchAll ?? !value.mailboxIds?.length;

  return { ...DEFAULTS, ...value, watchAll };
}

/** The addresses to ask about, or null for "no filter, every one of them". */
export function watchedMailboxIds(settings: Settings): string[] | null {
  return settings.watchAll ? null : settings.mailboxIds;
}

/** Nothing is being watched, so there is nothing to fetch or count. */
export function watchesNothing(settings: Settings) {
  return !settings.watchAll && settings.mailboxIds.length === 0;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  if (next.baseUrl) next.baseUrl = normalizeBase(next.baseUrl);
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

export function isConnected(settings: Settings) {
  return Boolean(settings.baseUrl && settings.apiKey);
}

/**
 * A URL a person typed, turned into an origin a fetch can use.
 *
 * People paste `mail.example.com`, `https://mail.example.com/` and
 * `https://mail.example.com/mail/all/inbox` in roughly equal measure. All
 * three mean the same instance.
 */
export function normalizeBase(input: string): string {
  let value = input.trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

/** The match pattern that covers one instance, for an optional permission. */
export function originPattern(baseUrl: string): string {
  const normal = normalizeBase(baseUrl);
  return normal ? `${normal}/*` : "";
}

export async function hasOriginPermission(baseUrl: string): Promise<boolean> {
  const origins = originPattern(baseUrl);
  if (!origins) return false;
  try {
    return await browser.permissions.contains({ origins: [origins] });
  } catch {
    return false;
  }
}
