import "server-only";
import { db } from "@/db";
import {
  attachment,
  contact,
  filterRule,
  mailbox,
  message,
  thread,
  threadLabel,
} from "@/db/schema";
import type { Folder } from "@/db/schema";
import { domainOf, makeSnippet, normalizeSubject } from "@/lib/mail";
import { newId } from "@/lib/utils";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { recomputeThread } from "./aggregate";

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

/** Finds the mailbox for a delivered address, falling back to a domain catch-all. */
async function resolveMailbox(address: string) {
  const normalized = address.toLowerCase();
  const domain = domainOf(normalized);

  const candidates = await db
    .select()
    .from(mailbox)
    .where(
      or(
        eq(mailbox.address, normalized),
        and(eq(mailbox.domain, domain), eq(mailbox.isCatchAll, true)),
      ),
    );

  return candidates.find((box) => box.address === normalized) ?? candidates[0] ?? null;
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
  userId: string,
  payload: InboundPayload,
  startingFolder: Folder,
): Promise<{ folder: Folder; markRead: boolean; star: boolean; labelIds: string[] }> {
  const rules = await db.query.filterRule.findMany({
    where: and(eq(filterRule.userId, userId), eq(filterRule.enabled, true)),
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
    const rules = await applyRules(box.userId, payload, spam ? "spam" : "inbox");

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
        userId: box.userId,
        address: payload.from.address.toLowerCase(),
        name: payload.from.name ?? null,
        messageCount: 1,
      })
      .onConflictDoUpdate({
        target: [contact.userId, contact.address],
        set: {
          messageCount: sql`${contact.messageCount} + 1`,
          lastSeenAt: new Date(),
          name: sql`coalesce(${contact.name}, excluded.name)`,
        },
      });

    await recomputeThread(threadId);
    stored.push(messageId);
  }

  return { stored };
}
