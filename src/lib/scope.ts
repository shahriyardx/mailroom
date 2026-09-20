import type { Folder } from "@/db/schema";

export const FOLDERS = ["inbox", "starred", "sent", "drafts", "archive", "spam", "trash"] as const;

export type ViewFolder = (typeof FOLDERS)[number];

/** "starred" is a saved view, not a real folder column. */
export function isRealFolder(view: ViewFolder): view is Folder {
  return view !== "starred";
}

export type Scope =
  | { kind: "all" }
  | { kind: "domain"; domain: string }
  | { kind: "mailbox"; mailboxId: string };

export const ALL_SCOPE: Scope = { kind: "all" };

/**
 * URL shapes:
 *   /mail                      -> all mail, inbox
 *   /mail/all/sent             -> every mailbox, sent
 *   /mail/d/acme.com/inbox     -> one domain, inbox
 *   /mail/m/mbx_123/drafts     -> one mailbox, drafts
 */
export function parseRoute(slug: string[] | undefined): { scope: Scope; folder: ViewFolder } {
  const segments = slug ?? [];
  if (segments.length === 0) return { scope: ALL_SCOPE, folder: "inbox" };

  const [head, ...rest] = segments;

  if (head === "d" && rest.length >= 1) {
    return { scope: { kind: "domain", domain: rest[0]! }, folder: toFolder(rest[1]) };
  }
  if (head === "m" && rest.length >= 1) {
    return { scope: { kind: "mailbox", mailboxId: rest[0]! }, folder: toFolder(rest[1]) };
  }
  if (head === "all") return { scope: ALL_SCOPE, folder: toFolder(rest[0]) };

  return { scope: ALL_SCOPE, folder: toFolder(head) };
}

function toFolder(value: string | undefined): ViewFolder {
  return FOLDERS.includes(value as ViewFolder) ? (value as ViewFolder) : "inbox";
}

export function scopeKey(scope: Scope) {
  if (scope.kind === "all") return "all";
  if (scope.kind === "domain") return `d:${scope.domain}`;
  return `m:${scope.mailboxId}`;
}

export function scopeHref(scope: Scope, folder: ViewFolder) {
  if (scope.kind === "domain") return `/mail/d/${scope.domain}/${folder}`;
  if (scope.kind === "mailbox") return `/mail/m/${scope.mailboxId}/${folder}`;
  return `/mail/all/${folder}`;
}

export const FOLDER_LABELS: Record<ViewFolder, string> = {
  inbox: "Inbox",
  starred: "Starred",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
  spam: "Spam",
  trash: "Trash",
};
