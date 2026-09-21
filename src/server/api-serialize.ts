import "server-only";
import type {
  Attachment,
  Contact,
  Domain,
  Label,
  Mailbox,
  Message,
  MessageEvent,
  Suppression,
  Thread,
  Webhook,
  WebhookDelivery,
} from "@/db/schema";
import { recordsForDomain } from "./domains";

/**
 * Row -> JSON, in one place.
 *
 * The API speaks snake_case and the database speaks camelCase, and every
 * object carries an `object` field so a client can tell what it is holding
 * without looking at which call returned it.
 */

export function serializeMailbox(row: Mailbox) {
  return {
    object: "mailbox" as const,
    id: row.id,
    address: row.address,
    domain: row.domain,
    domain_id: row.domainId,
    display_name: row.displayName,
    signature: row.signature,
    is_catch_all: row.isCatchAll,
    is_default: row.isDefault,
    color: row.color,
    created_at: row.createdAt,
  };
}

export function serializeDomain(row: Domain) {
  return {
    object: "domain" as const,
    id: row.id,
    name: row.name,
    region: row.region,
    status: row.status,
    sending_enabled: row.sendingEnabled,
    dkim_status: row.dkimStatus,
    dkim_origin: row.dkimOrigin,
    mail_from_domain: row.mailFromDomain,
    mail_from_status: row.mailFromStatus,
    spf_verified: row.spfVerified,
    dmarc_verified: row.dmarcVerified,
    inherited_from: row.inheritedFrom,
    auto_create_mailboxes: row.autoCreateMailboxes,
    imported: Boolean(row.importedAt),
    last_checked_at: row.lastCheckedAt,
    created_at: row.createdAt,
    records: recordsForDomain(row),
  };
}

export function serializeAttachment(row: Attachment) {
  return {
    object: "attachment" as const,
    id: row.id,
    message_id: row.messageId,
    filename: row.filename,
    content_type: row.contentType,
    size_bytes: row.sizeBytes,
    content_id: row.contentId,
    is_inline: row.isInline,
    created_at: row.createdAt,
  };
}

export function serializeEvent(row: MessageEvent) {
  return {
    object: "event" as const,
    id: row.id,
    type: row.type,
    recipient: row.recipient,
    detail: row.detail,
    occurred_at: row.occurredAt,
  };
}

interface MessageExtras {
  attachments?: Attachment[];
  events?: MessageEvent[];
  /** Bodies are large; list endpoints leave them out. */
  includeBody?: boolean;
  mailboxAddress?: string;
}

export function serializeMessage(row: Message, extra: MessageExtras = {}) {
  const base = {
    object: "message" as const,
    id: row.id,
    thread_id: row.threadId,
    mailbox_id: row.mailboxId,
    mailbox: extra.mailboxAddress,
    message_id: row.rfcMessageId,
    in_reply_to: row.inReplyTo,
    references: row.references,
    from: { name: row.fromName, address: row.fromAddress },
    to: row.to,
    cc: row.cc,
    bcc: row.bcc,
    reply_to: row.replyTo,
    subject: row.subject,
    snippet: row.snippet,
    folder: row.folder,
    direction: row.isOutbound ? ("outbound" as const) : ("inbound" as const),
    is_read: row.isRead,
    is_starred: row.isStarred,
    is_draft: row.isDraft,
    has_attachments: (extra.attachments?.length ?? 0) > 0,
    size_bytes: row.sizeBytes,
    // Inbound authentication, straight from the receiving worker.
    spf: row.spf,
    dkim: row.dkim,
    dmarc: row.dmarc,
    spam_score: row.spamScore,
    // Outbound delivery.
    ses_message_id: row.sesMessageId,
    status: row.deliveryStatus,
    error: row.deliveryError,
    opened_at: row.openedAt,
    open_count: row.openCount,
    api_key_id: row.apiKeyId,
    sent_at: row.sentAt,
    received_at: row.receivedAt,
    created_at: row.createdAt,
  };

  return {
    ...base,
    ...(extra.includeBody ? { text: row.textBody, html: row.htmlBody } : {}),
    ...(extra.attachments ? { attachments: extra.attachments.map(serializeAttachment) } : {}),
    ...(extra.events ? { events: extra.events.map(serializeEvent) } : {}),
  };
}

interface ThreadExtras {
  mailboxAddress?: string;
  mailboxColor?: string;
  domain?: string;
  labels?: Label[];
  messages?: ReturnType<typeof serializeMessage>[];
}

export function serializeThread(row: Thread, extra: ThreadExtras = {}) {
  return {
    object: "thread" as const,
    id: row.id,
    mailbox_id: row.mailboxId,
    mailbox: extra.mailboxAddress,
    mailbox_color: extra.mailboxColor,
    domain: extra.domain,
    subject: row.subject,
    snippet: row.snippet,
    folders: row.folders,
    participants: row.participants,
    message_count: row.messageCount,
    unread_count: row.unreadCount,
    is_starred: row.isStarred,
    has_attachments: row.hasAttachments,
    last_message_at: row.lastMessageAt,
    created_at: row.createdAt,
    ...(extra.labels ? { labels: extra.labels.map(serializeLabel) } : {}),
    ...(extra.messages ? { messages: extra.messages } : {}),
  };
}

export function serializeLabel(row: Label) {
  return {
    object: "label" as const,
    id: row.id,
    name: row.name,
    color: row.color,
    created_at: row.createdAt,
  };
}

export function serializeContact(row: Contact) {
  return {
    object: "contact" as const,
    id: row.id,
    address: row.address,
    name: row.name,
    message_count: row.messageCount,
    last_seen_at: row.lastSeenAt,
  };
}

export function serializeSuppression(row: Suppression) {
  return {
    object: "suppression" as const,
    id: row.id,
    address: row.address,
    reason: row.reason,
    created_at: row.createdAt,
  };
}

/** The secret is returned only when an endpoint is created, never on a read. */
export function serializeWebhook(row: Webhook, options: { secret?: boolean } = {}) {
  return {
    object: "webhook" as const,
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events,
    enabled: row.enabled,
    mailbox_id: row.mailboxId,
    last_status: row.lastStatus,
    last_delivered_at: row.lastDeliveredAt,
    last_error_at: row.lastErrorAt,
    last_error: row.lastError,
    consecutive_failures: row.consecutiveFailures,
    created_at: row.createdAt,
    ...(options.secret ? { secret: row.secret } : {}),
  };
}

export function serializeDelivery(row: WebhookDelivery) {
  return {
    object: "webhook_delivery" as const,
    id: row.id,
    webhook_id: row.webhookId,
    event: row.event,
    payload: row.payload,
    attempt: row.attempt,
    status_code: row.statusCode,
    response_body: row.responseBody,
    error: row.error,
    duration_ms: row.durationMs,
    succeeded: row.succeeded,
    created_at: row.createdAt,
  };
}
