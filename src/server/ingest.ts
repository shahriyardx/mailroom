import "server-only";
import { db } from "@/db";
import {
  attachment,
  contact,
  domain as domainTable,
  filterRule,
  mailbox,
  message,
  thread,
  threadLabel,
} from "@/db/schema";
import type { Folder } from "@/db/schema";
import { domainOf, makeSnippet, normalizeSubject } from "@/lib/mail";
import { colorOf, newId } from "@/lib/utils";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { recomputeThread } from "./aggregate";
import { publish } from "./realtime";
import { dispatchWebhooks } from "./webhooks";

export interface InboundAttachment {
  filename: string;
  contentType: string;
  sizeBytes: number;
  r2Key: string;
  contentId?: string | null;
  isInline?: boolean;
}

export interface InboundPayload {
  to: string;
  recipients?: string[];
  from: { name?: string | null; address: string };
  toAddresses?: { name?: string | null; address: string }[];
  ccAddresses?: { name?: string | null; address: string }[];
  replyTo?: string | null;
  subject: string;
  text?: string | null;
  html?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  date?: string | null;
  sizeBytes?: number;
  rawKey?: string | null;
  auth?: { spf?: string | null; dkim?: string | null; dmarc?: string | null };
  spamScore?: number | null;
}

/**
 * Finds the mailbox for a delivered address: an exact match first, then the
 * domain's catch-all, then — only if that domain asks for it — a mailbox
 * created on the spot for this address.
 */
async function resolveMailbox(address: string) {
  const normalized = address.toLowerCase();
  const domainName = domainOf(normalized);

  const candidates = await db
    .select()
    .from(mailbox)
    .where(
      or(
        eq(mailbox.address, normalized),
        and(eq(mailbox.domain, domainName), eq(mailbox.isCatchAll, true)),
      ),
    );

  const match = candidates.find((box) => box.address === normalized) ?? candidates[0] ?? null;
  if (match) return match;

  return createMailboxForAddress(normalized, domainName);
}

/**
 * Creates a mailbox for an address nobody claimed. Returns null unless the
 * domain is known here and has the setting switched on.
 */
async function createMailboxForAddress(address: string, domainName: string) {
  const domainRow = await db.query.domain.findFirst({
    where: eq(domainTable.name, domainName),
  });
  if (!domainRow?.autoCreateMailboxes) return null;

  const local = address.split("@")[0] ?? address;
  const id = newId("mbx");

  await db
    .insert(mailbox)
    .values({
      id,
      organizationId: domainRow.organizationId,
      address,
      domain: domainName,
      domainId: domainRow.id,
      displayName: local,
      color: colorOf(address),
    })
    // Two messages to a new address can arrive at once.
    .onConflictDoNothing();

  return (await db.query.mailbox.findFirst({ where: eq(mailbox.address, address) })) ?? null;
}

/** Threads by In-Reply-To / References first, then falls back to subject matching. */
async function findThread(mailboxId: string, payload: InboundPayload, subject: string) {
  const refs = [payload.inReplyTo, ...(payload.references ?? [])].filter(Boolean) as string[];

  if (refs.length > 0) {
    const [hit] = await db
      .select({ threadId: message.threadId })
      .from(message)
      .where(and(eq(message.mailboxId, mailboxId), inArray(message.rfcMessageId, refs)))
      .limit(1);
    if (hit) return hit.threadId;
  }

  if (subject) {
    const [hit] = await db
      .select({ id: thread.id })
      .from(thread)
      .where(
        and(
          eq(thread.mailboxId, mailboxId),
          sql`lower(${thread.subject}) = lower(${subject})`,
          sql`${thread.lastMessageAt} > now() - interval '30 days'`,
        ),
      )
      .orderBy(sql`${thread.lastMessageAt} desc`)
      .limit(1);
    if (hit) return hit.id;
  }

  return null;
}

async function applyRules(
  orgId: string,
  payload: InboundPayload,
  startingFolder: Folder,
): Promise<{ folder: Folder; markRead: boolean; star: boolean; labelIds: string[] }> {
  const rules = await db.query.filterRule.findMany({
    where: and(eq(filterRule.organizationId, orgId), eq(filterRule.enabled, true)),
    orderBy: (r, { desc }) => [desc(r.priority)],
  });

  const result = { folder: startingFolder, markRead: false, star: false, labelIds: [] as string[] };
  const haystack = {
    from: payload.from.address.toLowerCase(),
    to: (payload.toAddresses ?? [])
      .map((a) => a.address)
      .join(",")
      .toLowerCase(),
    subject: (payload.subject ?? "").toLowerCase(),
    body: (payload.text ?? "").toLowerCase(),
  };

  for (const rule of rules) {
    const conditions = [
      [rule.matchFrom, haystack.from],
      [rule.matchTo, haystack.to],
      [rule.matchSubject, haystack.subject],
      [rule.matchBody, haystack.body],
    ] as const;

    const active = conditions.filter(([needle]) => Boolean(needle));
    if (active.length === 0) continue;
    const matched = active.every(([needle, hay]) => hay.includes(needle!.toLowerCase()));
    if (!matched) continue;

    if (rule.actionFolder) result.folder = rule.actionFolder;
    if (rule.actionMarkRead) result.markRead = true;
    if (rule.actionStar) result.star = true;
    if (rule.actionLabelId) result.labelIds.push(rule.actionLabelId);
  }

  return result;
}

export async function ingestInbound(payload: InboundPayload, attachments: InboundAttachment[]) {
  const deliveredTo = (payload.recipients ?? [payload.to]).map((a) => a.toLowerCase());
  const stored: string[] = [];
  const announce: {
    orgId: string;
    mailboxId: string;
    threadId: string;
    from: string;
    subject: string;
  }[] = [];
  /** What each stored message needs for the outward webhook, in the same order. */
  const notify: { orgId: string; mailboxId: string; payload: Record<string, unknown> }[] = [];

  for (const address of deliveredTo) {
    const box = await resolveMailbox(address);
    if (!box) continue;

    // Ignore a message we already stored for this mailbox.
    if (payload.messageId) {
      const existing = await db.query.message.findFirst({
        where: and(eq(message.mailboxId, box.id), eq(message.rfcMessageId, payload.messageId)),
      });
      if (existing) {
        stored.push(existing.id);
        continue;
      }
    }

    const subject = payload.subject?.trim() ?? "";
    const normalized = normalizeSubject(subject);
    const receivedAt = payload.date ? new Date(payload.date) : new Date();

    const spam = (payload.spamScore ?? 0) >= 5 || payload.auth?.dmarc === "fail";
    const rules = await applyRules(box.organizationId, payload, spam ? "spam" : "inbox");

    let threadId = await findThread(box.id, payload, normalized);
    if (!threadId) {
      threadId = newId("thr");
      await db.insert(thread).values({
        id: threadId,
        mailboxId: box.id,
        subject,
        lastMessageAt: receivedAt,
      });
    }

    const messageId = newId("msg");
    await db.insert(message).values({
      id: messageId,
      threadId,
      mailboxId: box.id,
      rfcMessageId: payload.messageId ?? null,
      inReplyTo: payload.inReplyTo ?? null,
      references: payload.references ?? [],
      fromName: payload.from.name ?? null,
      fromAddress: payload.from.address.toLowerCase(),
      to: (payload.toAddresses ?? []).map((a) => ({ name: a.name ?? null, address: a.address })),
      cc: (payload.ccAddresses ?? []).map((a) => ({ name: a.name ?? null, address: a.address })),
      replyTo: payload.replyTo ?? null,
      subject,
      snippet: makeSnippet(payload.text ?? null, payload.html ?? null),
      textBody: payload.text ?? null,
      htmlBody: payload.html ?? null,
      folder: rules.folder,
      isRead: rules.markRead,
      isStarred: rules.star,
      isOutbound: false,
      spf: payload.auth?.spf ?? null,
      dkim: payload.auth?.dkim ?? null,
      dmarc: payload.auth?.dmarc ?? null,
      spamScore: payload.spamScore ?? null,
      sizeBytes: payload.sizeBytes ?? 0,
      rawKey: payload.rawKey ?? null,
      receivedAt,
      sentAt: receivedAt,
    });

    if (attachments.length > 0) {
      await db.insert(attachment).values(
        attachments.map((file) => ({
          id: newId("att"),
          messageId,
          filename: file.filename,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          r2Key: file.r2Key,
          contentId: file.contentId ?? null,
          isInline: file.isInline ?? false,
        })),
      );
    }

    if (rules.labelIds.length > 0) {
      await db
        .insert(threadLabel)
        .values(rules.labelIds.map((labelId) => ({ threadId, labelId })))
        .onConflictDoNothing();
    }

    await db
      .insert(contact)
      .values({
        id: newId("con"),
        organizationId: box.organizationId,
        address: payload.from.address.toLowerCase(),
        name: payload.from.name ?? null,
        messageCount: 1,
      })
      .onConflictDoUpdate({
        target: [contact.organizationId, contact.address],
        set: {
          messageCount: sql`${contact.messageCount} + 1`,
          lastSeenAt: new Date(),
          name: sql`coalesce(${contact.name}, excluded.name)`,
        },
      });

    await recomputeThread(threadId);
    stored.push(messageId);
    notify.push({
      orgId: box.organizationId,
      mailboxId: box.id,
      payload: {
        email: {
          id: messageId,
          thread_id: threadId,
          mailbox_id: box.id,
          mailbox: box.address,
          message_id: payload.messageId ?? null,
          from: { name: payload.from.name ?? null, address: payload.from.address },
          to: (payload.toAddresses ?? []).map((a) => ({
            name: a.name ?? null,
            address: a.address,
          })),
          delivered_to: address,
          subject,
          snippet: makeSnippet(payload.text ?? null, payload.html ?? null),
          folder: rules.folder,
          has_attachments: attachments.length > 0,
          spf: payload.auth?.spf ?? null,
          dkim: payload.auth?.dkim ?? null,
          dmarc: payload.auth?.dmarc ?? null,
          spam_score: payload.spamScore ?? null,
          received_at: receivedAt.toISOString(),
        },
      },
    });
    announce.push({
      orgId: box.organizationId,
      mailboxId: box.id,
      threadId,
      from: payload.from.name || payload.from.address,
      subject: payload.subject ?? "",
    });
  }

  // Tell any open browser on this account, so the list fills in by itself.
  for (const entry of announce) {
    await publish({ type: "mail:received", ...entry });
  }

  // And tell anything subscribed from outside. Not awaited: the worker that
  // handed us this message is waiting, and a slow endpoint of somebody else's
  // must not make it time out and redeliver.
  for (const entry of notify) {
    void dispatchWebhooks(entry.orgId, "mail.received", entry.payload, {
      mailboxId: entry.mailboxId,
    });
  }

  return { stored };
}
