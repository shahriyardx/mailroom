/**
 * The objects the API returns.
 *
 * Every one carries an `object` field, so a value can be told apart without
 * knowing which call produced it. Timestamps are ISO 8601 strings, because
 * that is what JSON carries — pass one to `new Date()` when you need a date.
 */

export type Folder = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";

export type DeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "rejected"
  | "delayed"
  | "failed"
  | "canceled";

export type DomainStatus = "pending" | "verified" | "failed" | "temporary_failure" | "not_started";

export type EventType =
  | "send"
  | "delivery"
  | "bounce"
  | "complaint"
  | "reject"
  | "open"
  | "click"
  | "delivery_delay"
  | "rendering_failure"
  | "subscription";

/** What an API key is allowed to do. `"*"` is all of them. */
export type Scope =
  | "emails:send"
  | "emails:read"
  | "mail:read"
  | "mail:write"
  | "mailboxes:read"
  | "mailboxes:write"
  | "domains:read"
  | "domains:write"
  | "labels:read"
  | "labels:write"
  | "contacts:read"
  | "templates:read"
  | "templates:write"
  | "suppressions:read"
  | "suppressions:write"
  | "webhooks:read"
  | "webhooks:write"
  | "stats:read";

/** The events a webhook endpoint can subscribe to. */
export type WebhookEventName =
  | "mail.received"
  | "email.sent"
  | "email.delivered"
  | "email.bounced"
  | "email.complained"
  | "email.opened"
  | "email.delayed"
  | "email.rejected"
  | "email.failed"
  | "email.canceled"
  | "thread.updated";

export interface EmailAddress {
  name: string | null;
  address: string;
}

/** One page of results. `next_cursor` is opaque: hand it back untouched. */
export interface Page<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

/* -------------------------------------------------------------------------- */
/* Mail                                                                       */
/* -------------------------------------------------------------------------- */

export interface Attachment {
  object: "attachment";
  id: string;
  message_id: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  content_id: string | null;
  is_inline: boolean;
  created_at: string;
}

/** An attachment read on its own, with a link good for five minutes. */
export interface AttachmentWithLink extends Attachment {
  download_url: string;
  download_url_expires_in: number;
}

/** Something SES reported about one message: a delivery, a bounce, an open. */
export interface MessageEvent {
  object: "event";
  id: string;
  type: EventType;
  recipient: string | null;
  detail: string | null;
  occurred_at: string;
}

export interface Message {
  object: "message";
  id: string;
  thread_id: string;
  mailbox_id: string;
  /** The mailbox address, when the endpoint had it to hand. */
  mailbox?: string;
  /** The RFC 5322 Message-ID. */
  message_id: string | null;
  in_reply_to: string | null;
  references: string[];
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  reply_to: string | null;
  subject: string;
  snippet: string;
  folder: Folder;
  direction: "inbound" | "outbound";
  is_read: boolean;
  is_starred: boolean;
  is_draft: boolean;
  has_attachments: boolean;
  size_bytes: number;
  /** Inbound authentication, as the receiving worker saw it. */
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  spam_score: number | null;
  /**
   * Who handed the message over, as against who it claims to be from: the
   * envelope sender's domain, the domain that signed it with DKIM, and how the
   * last hop reached us ("TLS1.3", or "none" for a plaintext hop).
   */
  mailed_by: string | null;
  signed_by: string | null;
  tls: string | null;
  /** Outbound delivery. */
  ses_message_id: string | null;
  status: DeliveryStatus | null;
  error: string | null;
  opened_at: string | null;
  open_count: number;
  api_key_id: string | null;
  /** Set while a message is waiting for its time; cleared once it goes out. */
  scheduled_at: string | null;
  /** True when a test key wrote it, and SES never saw it. */
  test: boolean;
  sent_at: string | null;
  received_at: string;
  created_at: string;
  /** Present on a single-message read, and on a list asked for `include_body`. */
  text?: string | null;
  html?: string | null;
  attachments?: Attachment[];
  events?: MessageEvent[];
}

export interface Label {
  object: "label";
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Thread {
  object: "thread";
  id: string;
  mailbox_id: string;
  mailbox?: string;
  mailbox_color?: string;
  domain?: string;
  subject: string;
  snippet: string;
  folders: Folder[];
  participants: EmailAddress[];
  message_count: number;
  unread_count: number;
  is_starred: boolean;
  has_attachments: boolean;
  last_message_at: string;
  created_at: string;
  labels?: Label[];
  /** Present when a single thread is read. */
  messages?: Message[];
}

export interface Mailbox {
  object: "mailbox";
  id: string;
  address: string;
  domain: string;
  domain_id: string | null;
  display_name: string;
  signature: string | null;
  is_catch_all: boolean;
  is_default: boolean;
  color: string;
  created_at: string;
}

/** A row to publish in DNS before a domain will send. */
export interface DnsRecord {
  kind: "CNAME" | "TXT" | "MX";
  name: string;
  value: string;
  priority?: number;
  purpose: string;
  required: boolean;
  /** Already in place and shown for reference; nothing to publish. */
  informational?: boolean;
}

export interface Domain {
  object: "domain";
  id: string;
  name: string;
  region: string;
  status: DomainStatus;
  sending_enabled: boolean;
  dkim_status: DomainStatus;
  dkim_origin: string | null;
  mail_from_domain: string | null;
  mail_from_status: DomainStatus | null;
  spf_verified: boolean;
  dmarc_verified: boolean;
  /** Set when this is a subdomain covered by a parent's verification. */
  inherited_from: string | null;
  auto_create_mailboxes: boolean;
  imported: boolean;
  last_checked_at: string | null;
  created_at: string;
  records: DnsRecord[];
}

export interface Contact {
  object: "contact";
  id: string;
  address: string;
  name: string | null;
  message_count: number;
  last_seen_at: string;
}

export interface Suppression {
  object: "suppression";
  id: string;
  address: string;
  reason: string;
  created_at: string;
}

/* -------------------------------------------------------------------------- */
/* Webhooks                                                                   */
/* -------------------------------------------------------------------------- */

export interface Webhook {
  object: "webhook";
  id: string;
  url: string;
  description: string | null;
  /** Event names, or `["*"]` for everything, including events added later. */
  events: string[];
  enabled: boolean;
  /** Scoped to one mailbox. Null unless `domain_id` is also null and it hears everything. */
  mailbox_id: string | null;
  /** Scoped to every address on one domain, including ones added later. */
  domain_id: string | null;
  last_status: number | null;
  last_delivered_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  created_at: string;
  /** Returned once, when the endpoint is created or its secret is rotated. */
  secret?: string;
}

export interface WebhookDelivery {
  object: "webhook_delivery";
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  attempt: number;
  status_code: number | null;
  response_body: string | null;
  error: string | null;
  duration_ms: number | null;
  succeeded: boolean;
  created_at: string;
}

/** What came back from a test or a replay. */
export interface WebhookAttempt {
  object: "webhook_ping" | "webhook_replay";
  webhook_id?: string;
  delivery_id?: string;
  succeeded: boolean;
  status_code: number | null;
  duration_ms: number | null;
  response_body: string | null;
  error: string | null;
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                    */
/* -------------------------------------------------------------------------- */

export interface AttachmentInput {
  filename: string;
  /** Base64. A `data:` prefix is stripped for you. */
  content: string;
  content_type?: string;
  /** Set to embed the file as an inline `cid:` image. */
  content_id?: string;
}

export interface SendEmailInput {
  /** An address on a verified domain. `Name <a@b.com>` works too. */
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string;
  subject?: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  /**
   * A saved template to send instead of a body written here, by id, with
   * `data` filling its holes. A `subject` given alongside it wins.
   */
  template?: string;
  template_id?: string;
  data?: Record<string, unknown>;
  /**
   * Hold the message until this time. An ISO 8601 timestamp, a Unix time, a
   * Date, or a relative form such as `"in 30 minutes"`. A time already past
   * sends now.
   */
  scheduled_at?: string | number | Date;
  /** Add this message to an existing thread. */
  thread_id?: string;
  in_reply_to?: string;
  references?: string[];
  /** At most twenty files. */
  attachments?: AttachmentInput[];
}

export interface SentEmail {
  id: string;
  /** The RFC 5322 Message-ID. */
  message_id: string | null;
  ses_message_id: string | null;
  thread_id: string;
  from: string;
  to: string[];
  subject: string;
  /**
   * `"sent"` reached SES. `"scheduled"` is waiting for its time and
   * `"queued"` is waiting for SES to be able to take it — both are still to
   * come, and both can be cancelled.
   */
  status: "sent" | "scheduled" | "queued" | DeliveryStatus;
  scheduled_at: string | null;
  /** True when a test key sent it, and SES never saw it. */
  test: boolean;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

export interface Template {
  object: "template";
  id: string;
  /** What a person calls it. */
  name: string;
  description: string | null;
  subject: string;
  html: string | null;
  text: string | null;
  /** Every name this template asks for, so you know what `data` must carry. */
  variables: string[];
  created_at: string;
  updated_at: string;
}

export interface TemplateInput {
  name: string;
  description?: string;
  subject?: string;
  html?: string;
  text?: string;
}

export type BatchResult =
  | ({ index: number; ok: true } & SentEmail)
  | { index: number; ok: false; error: string; status: number };

export interface BatchSendResult {
  object: "batch";
  sent: number;
  failed: number;
  data: BatchResult[];
}

/* -------------------------------------------------------------------------- */
/* Account                                                                    */
/* -------------------------------------------------------------------------- */

export interface ApiKeyInfo {
  object: "api_key";
  id: string;
  name: string;
  /** A test key runs every check and never hands anything to SES. */
  mode: "live" | "test";
  scopes: string[];
  organization: { id: string; name: string } | null;
  reach: {
    /** True when the key reaches every mailbox in the account. */
    unrestricted: boolean;
    domains: { id: string; name: string }[];
    mailboxes: { id: string; address: string }[];
  };
  reachable_mailboxes: number;
  rate_limit_per_minute: number;
  api: {
    version: string;
    base_url: string;
    all_scopes: Scope[];
    webhook_events: WebhookEventName[];
  };
}

export interface StatsDay {
  day: string;
  sent: number;
  received: number;
  delivered: number;
  bounced: number;
  opened: number;
}

export interface Stats {
  object: "stats";
  since: string;
  until: string;
  sending: {
    sent: number;
    delivered: number;
    bounced: number;
    complained: number;
    failed: number;
    opened: number;
    total_opens: number;
    /** Shares of sent mail out of 100. SES warns above 5 and 0.1. */
    bounce_rate: number;
    complaint_rate: number;
    open_rate: number;
  };
  receiving: { received: number; threads: number; unread: number };
  drafts: number;
  bytes: number;
  days: StatsDay[];
  mailboxes: { id: string; address: string; sent: number; received: number }[];
}

/** What a delete returns. */
export interface Deleted {
  object: string;
  id: string;
  deleted: true;
  [key: string]: unknown;
}
