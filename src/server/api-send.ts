import "server-only";

import { db } from "@/db";
import { domain, mailbox } from "@/db/schema";
import { type EmailAddress, coveringDomain, parseAddress, parseAddressList } from "@/lib/mail";
import type { MimeAttachment } from "@/lib/mime";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { ApiCaller } from "./api-auth";
import { mailboxForSending } from "./mailboxes";
import { SendError, deliverMessage } from "./send";

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
  headers: z.record(z.string()).optional(),
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
    subject: input.subject,
    html: input.html ?? null,
    text: input.text ?? null,
    headers: input.headers,
    inlineAttachments: files,
    threadId: input.thread_id,
    inReplyTo: input.in_reply_to ?? null,
    references: input.references,
    apiKeyId: caller.keyId,
  });

  return {
    id: result.messageId,
    message_id: result.rfcMessageId,
    ses_message_id: result.sesMessageId || null,
    thread_id: result.threadId,
    from: box.address,
    to: to.map((entry) => entry.address),
    subject: input.subject,
  };
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
