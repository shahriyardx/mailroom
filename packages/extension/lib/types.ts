/**
 * The slice of the Mailroom v1 API this extension reads.
 *
 * Hand-written rather than imported: the published SDK is a Node package and
 * pulling it in would bring a build step and a versioning problem into a
 * bundle that only ever calls six endpoints. These mirror
 * `src/server/api-serialize.ts`, and only the fields used here are named.
 */

export interface Address {
  name: string | null;
  address: string;
}

export interface ApiLabel {
  object: "label";
  id: string;
  name: string;
  color: string;
}

export interface ApiAttachment {
  object: "attachment";
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  is_inline: boolean;
}

export interface ApiMessage {
  object: "message";
  id: string;
  thread_id: string;
  subject: string | null;
  snippet: string | null;
  from: Address;
  to: Address[];
  cc: Address[];
  folder: string;
  direction: "inbound" | "outbound";
  is_read: boolean;
  is_starred: boolean;
  is_draft: boolean;
  has_attachments: boolean;
  received_at: string;
  sent_at: string | null;
  /** Only on the single-thread endpoint. */
  text?: string | null;
  html?: string | null;
  attachments?: ApiAttachment[];
}

export interface ApiThread {
  object: "thread";
  id: string;
  mailbox_id: string;
  mailbox?: string;
  mailbox_color?: string;
  domain?: string;
  subject: string | null;
  snippet: string | null;
  folders: string[];
  participants: Address[];
  message_count: number;
  unread_count: number;
  is_starred: boolean;
  has_attachments: boolean;
  last_message_at: string;
  labels?: ApiLabel[];
  /** Only on the single-thread endpoint. */
  messages?: ApiMessage[];
}

export interface ApiMailbox {
  object: "mailbox";
  id: string;
  address: string;
  domain: string;
  display_name: string | null;
  color: string;
  is_default: boolean;
}

export interface ApiIdentity {
  object: "api_key";
  id: string;
  name: string;
  mode: "live" | "test";
  scopes: string[];
  organization: { id: string; name: string } | null;
  reach: { unrestricted: boolean; domains: { id: string; name: string }[] };
  reachable_mailboxes: number;
  rate_limit_per_minute: number;
}

export interface ApiList<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * What the popup can be looking at.
 *
 * Not the same list as the API's folders: "unread" and "starred" are filters
 * over them, and a reader thinks of all seven as places to go. {@link query}
 * in lib/api.ts turns one of these back into the parameters the API wants.
 */
export const VIEWS = ["inbox", "unread", "starred", "sent", "archive", "spam", "trash"] as const;
export type View = (typeof VIEWS)[number];

/** The folder a view lives in, and the dashboard path that shows it. */
export const VIEW_FOLDER: Record<View, string> = {
  inbox: "inbox",
  unread: "inbox",
  starred: "all",
  sent: "sent",
  archive: "archive",
  spam: "spam",
  trash: "trash",
};

export const VIEW_LABEL: Record<View, string> = {
  inbox: "Inbox",
  unread: "Unread",
  starred: "Starred",
  sent: "Sent",
  archive: "Archive",
  spam: "Spam",
  trash: "Trash",
};
