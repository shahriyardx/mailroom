import "server-only";
import { db } from "@/db";
import {
  domain,
  type Folder,
  attachment,
  contact,
  mailbox,
  message,
  suppression,
  thread,
} from "@/db/schema";
import { env } from "@/lib/env";
import {
  type EmailAddress,
  coveringDomain,
  generateMessageId,
  htmlToText,
  makeSnippet,
  textToHtml,
} from "@/lib/mail";
import { type MimeAttachment, buildMime } from "@/lib/mime";
import { getObject } from "@/lib/r2";
import { sendRawEmail } from "@/lib/ses";
import { newId } from "@/lib/utils";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { recomputeThread } from "./aggregate";
import { publish } from "./realtime";
import { dispatchWebhooks } from "./webhooks";

export interface DeliverInput {
  orgId: string;
  mailboxId: string;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: string;
  subject: string;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, string>;
  /** Attachment rows already staged in R2. */
  attachmentIds?: string[];
  /**
   * Who is attaching them. Staged rows are claimed by id, and an id is not
   * a secret: without tying the claim to the uploader, anyone signed in
   * could attach somebody else's upload — or a stored message's attachment
   * from any account — to their own outgoing mail and read it that way.
   */
  senderUserId?: string;
  /** Attachments handed straight to us, as the public API does. */
  inlineAttachments?: MimeAttachment[];
  threadId?: string;
  inReplyTo?: string | null;
  references?: string[];
  /** Existing draft row to convert into the sent message. */
  draftId?: string;
  apiKeyId?: string;
}

export class SendError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "SendError";
  }
}

/**
 * The single outbound path: builds MIME, hands it to SES, then records the
 * message in the Sent folder. Used by the composer and the public API alike.
 */
export async function deliverMessage(input: DeliverInput) {
  const box = await db.query.mailbox.findFirst({
    where: and(eq(mailbox.id, input.mailboxId), eq(mailbox.organizationId, input.orgId)),
  });
  if (!box) throw new SendError("Unknown mailbox", 404);

  if (input.to.length === 0) throw new SendError("Add at least one recipient");

  // A subdomain sends on its parent's verification, so match the covering
  // domain rather than an exact name.
  const owned = await db.query.domain.findMany({ where: eq(domain.organizationId, input.orgId) });
  const domainRow = coveringDomain(box.address, owned);
  if (domainRow && !(domainRow.sendingEnabled && domainRow.status === "verified")) {
    throw new SendError(`${domainRow.name} is not verified for sending in SES yet`, 409);
  }

  const recipients = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];
  const blocked = await db
    .select({ address: suppression.address })
    .from(suppression)
    .where(
      and(
        eq(suppression.organizationId, input.orgId),
        inArray(
          suppression.address,
          recipients.map((entry) => entry.address),
        ),
      ),
    );
  if (blocked.length > 0) {
    throw new SendError(
      `Blocked after an earlier bounce or complaint: ${blocked.map((row) => row.address).join(", ")}`,
      409,
    );
  }

  if (input.attachmentIds?.length && !input.senderUserId) {
    throw new SendError("Staged attachments need a signed-in sender");
  }
  const staged = input.attachmentIds?.length
    ? await db
        .select()
        .from(attachment)
        .where(
          and(
            inArray(attachment.id, input.attachmentIds),
            // Only this person's own uploads, and only ones not yet part of
            // a message.
            eq(attachment.uploadedBy, input.senderUserId ?? ""),
            isNull(attachment.messageId),
          ),
        )
    : [];

  const stagedFiles: MimeAttachment[] = await Promise.all(
    staged.map(async (file) => {
      const object = await getObject(file.r2Key);
      const bytes = await object.Body!.transformToByteArray();
      return {
        filename: file.filename,
        content: Buffer.from(bytes),
        contentType: file.contentType,
      };
    }),
  );

  const html = input.html?.trim() ? input.html : input.text ? textToHtml(input.text) : "";
  const text = input.text?.trim() ? input.text : html ? htmlToText(html) : "";

  const rfcMessageId = generateMessageId(box.domain);
  const from: EmailAddress = { name: box.displayName, address: box.address };

  const raw = await buildMime({
    from,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    replyTo: input.replyTo,
    subject: input.subject,
    html: html || null,
    text: text || null,
    messageId: rfcMessageId,
    inReplyTo: input.inReplyTo,
    references: input.references,
    headers: input.headers,
    attachments: [...stagedFiles, ...(input.inlineAttachments ?? [])],
  });

  let sesMessageId = "";
  try {
    const result = await sendRawEmail({
      raw,
      from: box.address,
      to: recipients.map((entry) => entry.address),
      configurationSet: env.aws.configurationSet,
    });
    sesMessageId = result.messageId;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "SES rejected the message";
    throw new SendError(detail, 502);
  }

  let threadId = input.threadId;
  if (threadId) {
    const owned = await db.query.thread.findFirst({
      where: and(eq(thread.id, threadId), eq(thread.mailboxId, box.id)),
    });
    if (!owned) threadId = undefined;
  }
  if (!threadId) {
    threadId = newId("thr");
    await db.insert(thread).values({ id: threadId, mailboxId: box.id, subject: input.subject });
  }

  const messageId = input.draftId ?? newId("msg");
  const values = {
    threadId,
    mailboxId: box.id,
    rfcMessageId,
    inReplyTo: input.inReplyTo ?? null,
    references: input.references ?? [],
    fromName: box.displayName,
    fromAddress: box.address,
    to: input.to,
    cc: input.cc ?? [],
    bcc: input.bcc ?? [],
    replyTo: input.replyTo ?? null,
    subject: input.subject,
    snippet: makeSnippet(text, html),
    textBody: text || null,
    htmlBody: html || null,
    folder: "sent" as Folder,
    isRead: true,
    isDraft: false,
    isOutbound: true,
    sesMessageId: sesMessageId || null,
    deliveryStatus: "sent" as const,
    apiKeyId: input.apiKeyId ?? null,
    sizeBytes: raw.byteLength,
    sentAt: new Date(),
    receivedAt: new Date(),
  };

  if (input.draftId) {
    await db.update(message).set(values).where(eq(message.id, input.draftId));
  } else {
    await db.insert(message).values({ id: messageId, ...values });
  }

  if (staged.length > 0) {
    await db
      .update(attachment)
      .set({ messageId })
      .where(
        inArray(
          attachment.id,
          staged.map((file) => file.id),
        ),
      );
  }

  for (const entry of [...input.to, ...(input.cc ?? [])]) {
    await db
      .insert(contact)
      .values({
        id: newId("con"),
        organizationId: input.orgId,
        address: entry.address,
        name: entry.name,
        messageCount: 1,
      })
      .onConflictDoUpdate({
        target: [contact.organizationId, contact.address],
        set: { messageCount: sql`${contact.messageCount} + 1`, lastSeenAt: new Date() },
      });
  }

  await recomputeThread(threadId);
  await publish({ type: "mail:sent", orgId: input.orgId, mailboxId: box.id, threadId });

  // Fired here rather than from the SES event stream, so it arrives whether
  // or not a configuration set has been set up, and the moment SES accepts
  // the message rather than a second or two later.
  void dispatchWebhooks(
    input.orgId,
    "email.sent",
    {
      email: {
        id: messageId,
        thread_id: threadId,
        mailbox_id: box.id,
        mailbox: box.address,
        ses_message_id: sesMessageId || null,
        message_id: rfcMessageId,
        from: box.address,
        to: input.to,
        cc: input.cc ?? [],
        subject: input.subject,
        status: "sent",
        api_key_id: input.apiKeyId ?? null,
        sent_at: new Date().toISOString(),
      },
    },
    { mailboxId: box.id },
  );

  return { threadId, messageId, sesMessageId, rfcMessageId };
}
