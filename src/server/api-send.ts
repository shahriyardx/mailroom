import "server-only";

import { db } from "@/db";
import { domain, mailbox } from "@/db/schema";
import { type EmailAddress, coveringDomain, parseAddress, parseAddressList } from "@/lib/mail";
import type { MimeAttachment } from "@/lib/mime";
import { parseSchedule } from "@/lib/schedule";
import { TemplateError } from "@/lib/template";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { ApiCaller } from "./api-auth";
import { mailboxForSending } from "./mailboxes";
import { SendError, deliverMessage } from "./send";
import { TemplateNotFound, renderFor } from "./templates";

const addresses = z.union([z.string(), z.array(z.string())]);

/** At most this many files on one message, matching what SES will carry. */
const MAX_ATTACHMENTS = 20;

export const emailSchema = z.object({
  from: z.string().min(3),
  to: addresses,
  cc: addresses.optional(),
  bcc: addresses.optional(),
  reply_to: z.string().optional(),
  subject: z.string().default(""),
  html: z.string().optional(),
  text: z.string().optional(),
  /**
   * A saved template to send instead of a body written here, by id or by
   * slug. `data` fills its holes. A `subject` given alongside it wins, so a
   * one-off can override the saved line without a second template.
   */
  template: z.string().optional(),
  template_id: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  /**
   * Hold the message until this time. An ISO 8601 timestamp, a Unix time, or
   * a relative form such as "in 30 minutes". A time that has already passed
   * sends now.
   */
  scheduled_at: z.union([z.string(), z.number()]).optional(),
  /** Existing thread to add this message to, so replies stay together. */
  thread_id: z.string().optional(),
  in_reply_to: z.string().optional(),
  references: z.array(z.string()).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1),
        /** Base64 file contents. */
        content: z.string().min(1),
        content_type: z.string().optional(),
        /** Set to embed the file as an inline cid: image. */
        content_id: z.string().optional(),
      }),
    )
    .max(MAX_ATTACHMENTS)
    .optional(),
});

export type EmailInput = z.infer<typeof emailSchema>;

export function toList(value: z.infer<typeof addresses> | undefined): EmailAddress[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(", ") : value;
  return parseAddressList(raw);
}

/**
 * The mailbox a key may send this message from.
 *
 * A key that names addresses may only use those. A key that names domains may
 * send as any address on them, and the mailbox is made on first use: SES
 * already permits it, and code sends from noreply@ and receipts@ that nobody
 * would think to create by hand. A key with neither may use the whole
 * account, which is what it has always meant.
 */
export async function senderFor(caller: ApiCaller, fromAddress: string) {
  const address = fromAddress.toLowerCase().trim();

  if (caller.reach.unrestricted) {
    const box = await mailboxForSending(caller.orgId, address);
    if (!box) {
      return {
        box: null,
        reason: `${address} is not on a domain this account has verified for sending`,
      };
    }
    return { box, reason: null };
  }

  const existing = await db.query.mailbox.findFirst({
    where: and(eq(mailbox.address, address), eq(mailbox.organizationId, caller.orgId)),
  });

  if (existing) {
    const named = caller.reach.mailboxIds.includes(existing.id);
    const byDomain =
      existing.domainId !== null && caller.reach.domainIds.includes(existing.domainId);
    if (named || byDomain) return { box: existing, reason: null };
    return { box: null, reason: `This API key cannot send as ${address}` };
  }

  // No mailbox yet. Only a domain this key holds can bring one into being.
  if (caller.reach.domainIds.length === 0) {
    return { box: null, reason: `This API key cannot send as ${address}` };
  }

  const reachable = await db
    .select({ id: domain.id, name: domain.name })
    .from(domain)
    .where(
      and(eq(domain.organizationId, caller.orgId), inArray(domain.id, caller.reach.domainIds)),
    );

  if (!coveringDomain(address, reachable)) {
    return { box: null, reason: `This API key cannot send as ${address}` };
  }

  const box = await mailboxForSending(caller.orgId, address);
  if (!box) {
    return {
      box: null,
      reason: `${address} is not on a domain this account has verified for sending`,
    };
  }
  return { box, reason: null };
}

export interface SentResult {
  id: string;
  message_id: string | null;
  ses_message_id: string | null;
  thread_id: string;
  from: string;
  to: string[];
  subject: string;
  /**
   * "sent" reached SES. "scheduled" is waiting for its time, "queued" is
   * waiting for SES to be able to take it, and both are still to come.
   */
  status: string;
  scheduled_at: string | null;
}

/**
 * One message, end to end: pick the mailbox, decode the files, hand it to the
 * single outbound path the composer also uses.
 *
 * Throws {@link SendError} for anything the caller can act on, which the route
 * turns into a status code.
 */
export async function sendOne(caller: ApiCaller, input: EmailInput): Promise<SentResult> {
  const fromAddress = parseAddress(input.from).address;
  const { box, reason } = await senderFor(caller, fromAddress);
  if (!box) throw new SendError(reason ?? "Cannot send from that address", 403);

  let scheduledAt: Date | null = null;
  if (input.scheduled_at !== undefined) {
    const parsed = parseSchedule(input.scheduled_at);
    if ("error" in parsed) throw new SendError(parsed.error, 422);
    scheduledAt = parsed.at;
  }

  const body = await resolveBody(caller.orgId, input);

  const to = toList(input.to);
  const files: MimeAttachment[] = (input.attachments ?? []).map((file) => ({
    filename: file.filename,
    content: decodeBase64(file.content, file.filename),
    contentType: file.content_type,
    cid: file.content_id,
  }));

  const result = await deliverMessage({
    orgId: caller.orgId,
    mailboxId: box.id,
    to,
    cc: toList(input.cc),
    bcc: toList(input.bcc),
    replyTo: input.reply_to,
    subject: body.subject,
    html: body.html,
    text: body.text,
    headers: input.headers,
    inlineAttachments: files,
    threadId: input.thread_id,
    inReplyTo: input.in_reply_to ?? null,
    references: input.references,
    apiKeyId: caller.keyId,
    scheduledAt,
  });

  return {
    id: result.messageId,
    message_id: result.rfcMessageId,
    ses_message_id: result.sesMessageId || null,
    thread_id: result.threadId,
    from: box.address,
    to: to.map((entry) => entry.address),
    subject: body.subject,
    status: result.status,
    scheduled_at: result.scheduledAt ? result.scheduledAt.toISOString() : null,
  };
}

/**
 * The subject and body this message is actually made of.
 *
 * Without a template that is whatever the request wrote. With one, it is the
 * saved wording with the values filled in — except the subject, which the
 * request may still override, because a one-off variation on a saved subject
 * is a real thing and making a second template for it is not.
 */
async function resolveBody(orgId: string, input: EmailInput) {
  const reference = input.template_id ?? input.template;

  if (!reference) {
    return {
      subject: input.subject,
      html: input.html ?? null,
      text: input.text ?? null,
    };
  }

  try {
    const rendered = await renderFor(orgId, reference, input.data ?? {});
    return {
      // `subject` has a default of "", so an untouched request cannot be told
      // from one that meant an empty subject. Only a non-empty one overrides.
      subject: input.subject || rendered.subject,
      html: input.html ?? rendered.html,
      text: input.text ?? rendered.text,
    };
  } catch (error) {
    if (error instanceof TemplateNotFound) throw new SendError(error.message, 404);
    if (error instanceof TemplateError) throw new SendError(error.message, 422);
    throw error;
  }
}

function decodeBase64(value: string, filename: string) {
  const cleaned = value.replace(/^data:[^;]*;base64,/, "");
  const buffer = Buffer.from(cleaned, "base64");
  // Buffer.from never throws on bad base64, it drops what it cannot read, so
  // an empty result from a non-empty string is the only signal available.
  if (buffer.byteLength === 0) {
    throw new SendError(`The attachment "${filename}" is not valid base64`, 422);
  }
  return buffer;
}
