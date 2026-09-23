/**
 * What an API key is allowed to do.
 *
 * A key carries a list of these. "*" is every scope, which is what keys made
 * before scopes existed already had, so nothing that worked stops working.
 *
 * Scopes say which kinds of call are allowed. They are separate from a key's
 * optional mailbox lock, which says which mail those calls may touch — both
 * are checked, and neither substitutes for the other.
 */
export const SCOPES = [
  "emails:send",
  "emails:read",
  "mail:read",
  "mail:write",
  "mailboxes:read",
  "mailboxes:write",
  "domains:read",
  "domains:write",
  "labels:read",
  "labels:write",
  "contacts:read",
  "templates:read",
  "templates:write",
  "suppressions:read",
  "suppressions:write",
  "webhooks:read",
  "webhooks:write",
  "stats:read",
  "lists:read",
  "lists:write",
] as const;

export type Scope = (typeof SCOPES)[number];

export const WILDCARD = "*";

/**
 * Writing implies reading. Nobody grants "change a mailbox" while meaning
 * "but do not look at it", and making them tick both is a trap that shows up
 * only as a 403 in production.
 */
const IMPLIES: Partial<Record<Scope, Scope[]>> = {
  "mail:write": ["mail:read"],
  "mailboxes:write": ["mailboxes:read"],
  "domains:write": ["domains:read"],
  "labels:write": ["labels:read"],
  "suppressions:write": ["suppressions:read"],
  "webhooks:write": ["webhooks:read"],
  "templates:write": ["templates:read"],
  "emails:send": ["emails:read"],
  "lists:write": ["lists:read"],
};

/** Everything a list of scopes grants, including what each one implies. */
export function expandScopes(granted: readonly string[]): Set<string> {
  if (granted.includes(WILDCARD)) return new Set<string>([WILDCARD, ...SCOPES]);

  const out = new Set<string>();
  for (const scope of granted) {
    if (!isScope(scope)) continue;
    out.add(scope);
    for (const implied of IMPLIES[scope] ?? []) out.add(implied);
  }
  return out;
}

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

export function hasScope(granted: Set<string>, needed: Scope) {
  return granted.has(WILDCARD) || granted.has(needed);
}

/** Ready-made sets, so the common cases do not need sixteen decisions. */
export const PRESETS: { id: string; label: string; hint: string; scopes: string[] }[] = [
  {
    id: "full",
    label: "Full access",
    hint: "Everything this instance's API can do.",
    scopes: [WILDCARD],
  },
  {
    id: "send",
    label: "Send only",
    hint: "Send mail and check what happened to it. Cannot read your inbox.",
    scopes: ["emails:send", "emails:read", "templates:read"],
  },
  {
    id: "read",
    label: "Read only",
    hint: "Read mail, mailboxes, domains and stats. Cannot send or change anything.",
    scopes: [
      "emails:read",
      "mail:read",
      "mailboxes:read",
      "domains:read",
      "labels:read",
      "contacts:read",
      "templates:read",
      "suppressions:read",
      "webhooks:read",
      "stats:read",
    ],
  },
  {
    id: "inbox",
    label: "Inbox agent",
    hint: "Read and organise mail, and reply to it. Cannot manage domains or keys.",
    scopes: [
      "emails:send",
      "emails:read",
      "mail:read",
      "mail:write",
      "mailboxes:read",
      "labels:read",
      "labels:write",
      "contacts:read",
      "templates:read",
      "stats:read",
    ],
  },
];

/**
 * The scopes, grouped the way somebody decides them.
 *
 * Sixteen checkboxes is a wall: nobody reads it, and the honest answer to a
 * wall is to tick everything. An area with one choice — nothing, read, or
 * change — is the same decision asked once, and it cannot produce the
 * nonsense of "may change, may not see".
 *
 * Each level lists the scopes it grants, lowest first. Level 0 is always
 * nothing.
 */
export interface ScopeArea {
  id: string;
  label: string;
  hint: string;
  levels: { label: string; scopes: Scope[] }[];
}

export const SCOPE_AREAS: ScopeArea[] = [
  {
    id: "sending",
    label: "Sending",
    hint: "Send mail, and see what happened to it",
    levels: [
      { label: "None", scopes: [] },
      { label: "Read", scopes: ["emails:read"] },
      { label: "Send", scopes: ["emails:send", "emails:read"] },
    ],
  },
  {
    id: "mail",
    label: "Mail",
    hint: "Threads, messages, attachments",
    levels: [
      { label: "None", scopes: [] },
      { label: "Read", scopes: ["mail:read"] },
      { label: "Manage", scopes: ["mail:read", "mail:write"] },
    ],
  },
  {
    id: "mailboxes",
    label: "Mailboxes",
    hint: "The addresses on your domains",
    levels: [
      { label: "None", scopes: [] },
      { label: "Read", scopes: ["mailboxes:read"] },
      { label: "Manage", scopes: ["mailboxes:read", "mailboxes:write"] },
    ],
  },
  {
    id: "domains",
    label: "Domains",
    hint: "Add, verify and remove sending domains",
    levels: [
      { label: "None", scopes: [] },
      { label: "Read", scopes: ["domains:read"] },
      { label: "Manage", scopes: ["domains:read", "domains:write"] },
    ],
  },
  {
    id: "labels",
    label: "Labels",
    hint: "The labels threads are filed under",
    levels: [
      { label: "None", scopes: [] },
      { label: "Read", scopes: ["labels:read"] },
      { label: "Manage", scopes: ["labels:read", "labels:write"] },
    ],
  },
  {
    id: "contacts",
    label: "Contacts",
    hint: "Everyone this account has written to",
    levels: [
      { label: "None", scopes: [] },
      { label: "Read", scopes: ["contacts:read"] },
    ],
  },
  {
    id: "templates",
    label: "Templates",
    hint: "Saved subjects and bodies to send by name",
    levels: [
      { label: "None", scopes: [] },
      { label: "Read", scopes: ["templates:read"] },
      { label: "Manage", scopes: ["templates:read", "templates:write"] },
    ],
  },
  {
    id: "suppressions",
    label: "Blocklist",
    hint: "Addresses that bounced or complained",
    levels: [
      { label: "None", scopes: [] },
      { label: "Read", scopes: ["suppressions:read"] },
      { label: "Manage", scopes: ["suppressions:read", "suppressions:write"] },
    ],
  },
  {
    id: "webhooks",
    label: "Webhooks",
    hint: "Where events are sent, and their history",
    levels: [
      { label: "None", scopes: [] },
      { label: "Read", scopes: ["webhooks:read"] },
      { label: "Manage", scopes: ["webhooks:read", "webhooks:write"] },
    ],
  },
  {
    id: "stats",
    label: "Statistics",
    hint: "How much was sent, and how it landed",
    levels: [
      { label: "None", scopes: [] },
      { label: "Read", scopes: ["stats:read"] },
    ],
  },
];

/** The highest level of an area a list of scopes reaches. */
export function levelOf(area: ScopeArea, granted: readonly string[]) {
  if (granted.includes(WILDCARD)) return area.levels.length - 1;
  for (let index = area.levels.length - 1; index > 0; index -= 1) {
    const level = area.levels[index];
    if (level?.scopes.every((scope) => granted.includes(scope))) return index;
  }
  return 0;
}

/**
 * Every area at its highest level, written out.
 *
 * What "*" means today, spelled as names. Moving from full access to a custom
 * choice starts here rather than at nothing: somebody narrowing a key wants
 * to take things away, not build it again from scratch.
 */
export function everyScope(): Scope[] {
  return scopesForLevels(
    Object.fromEntries(SCOPE_AREAS.map((area) => [area.id, area.levels.length - 1])),
  );
}

/** The scopes a set of per-area levels adds up to. */
export function scopesForLevels(levels: Record<string, number>) {
  const out = new Set<Scope>();
  for (const area of SCOPE_AREAS) {
    for (const scope of area.levels[levels[area.id] ?? 0]?.scopes ?? []) out.add(scope);
  }
  return [...out];
}

/**
 * What a key can do, in words, for a list where the scope names themselves
 * would be a paragraph of punctuation.
 */
export function describeAreas(granted: readonly string[]) {
  if (granted.includes(WILDCARD)) return "Full access";
  const parts = SCOPE_AREAS.map((area) => {
    const level = levelOf(area, granted);
    if (level === 0) return null;
    const name = area.levels[level]?.label ?? "";
    // "Sending: Send" says the same thing twice.
    return name === "Read" ? `${area.label} (read)` : area.label;
  }).filter((part): part is string => part !== null);

  return parts.length === 0 ? "No access" : parts.join(" · ");
}

/** The scope names a key holds, spelled the way the API reports them. */
export function describeScopes(granted: readonly string[]) {
  return granted.includes(WILDCARD) ? [WILDCARD] : granted.filter(isScope);
}
