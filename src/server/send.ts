import "server-only";
import { db } from "@/db";
import {
  domain,
  type DeliveryStatus,
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
import { simulatedOutcome } from "@/lib/test-mode";
import { newId } from "@/lib/utils";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { recomputeThread } from "./aggregate";
import { backoffMs, describeError, enqueueSend, isRetryableSendError } from "./outbox";
import { publish } from "./realtime";
import { type SentContext, announceSent, recordSimulated } from "./sent";

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
  /**
   * Hold the message until this time rather than sending it now. A time that
   * has already passed is treated as "now", which is what somebody scheduling
   * something a second ago meant.
   */
  scheduledAt?: Date | null;
  /**
   * Run everything except the part that hands the message to SES. Used by a
   * test key, so a receiver can be pointed at a real send that never leaves.
   */
  testMode?: boolean;
}

export interface DeliverResult {
  threadId: string;
  messageId: string;
  sesMessageId: string;
  rfcMessageId: string;
  /**
   * What happened to it. "sent" reached SES; "scheduled" and "queued" are
   * waiting, for the clock and for SES respectively; "delivered" is a test
   * send, which never had anywhere to go.
   */
  status: "sent" | "scheduled" | "queued" | DeliveryStatus;
  scheduledAt: Date | null;
  /** Why it is waiting rather than sent, when it is waiting because of SES. */
  queuedReason: string | null;
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
 *
 * Three things can happen. It goes out, which is the usual one. It is held —
 * because it was scheduled for later, or because SES could not take it right
 * now — and the queue carries it from there. Or SES refuses it for a reason
 * that will not change, and this throws, having written nothing.
 */
export async function deliverMessage(input: DeliverInput): Promise<DeliverResult> {
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

  /* ---------------------------------------------------------------------- */
  /* Decide what happens to it before anything is written down               */
  /* ---------------------------------------------------------------------- */

  // Nothing is recorded until the outcome is known. A message SES refuses
  // outright leaves no trace, which is what it did before there was a queue.

  const due =
    input.scheduledAt && input.scheduledAt.getTime() > Date.now() ? input.scheduledAt : null;
  const envelope = recipients.map((entry) => entry.address);

  let sesMessageId = "";
  let status: DeliverResult["status"] = "sent";
  let queuedReason: string | null = null;
  let queueAfterWrite: { attempts: number; dueAt: Date } | null = null;
  let simulated: ReturnType<typeof simulatedOutcome> | null = null;

  if (due) {
    status = "scheduled";
    queueAfterWrite = { attempts: 0, dueAt: due };
  } else if (input.testMode) {
    // A test key runs every check above this line and stops here. The address
    // it is going to decides what it is made to look like.
    simulated = simulatedOutcome(input.to[0]?.address ?? "");
    status = simulated;
    sesMessageId = "";
  } else {
    try {
      const result = await sendRawEmail({
        raw,
        from: box.address,
        to: envelope,
        configurationSet: env.aws.configurationSet,
      });
      sesMessageId = result.messageId;
    } catch (error) {
      // SES turning a message away for a reason that will still be true in an
      // hour is a refusal. Anything else — throttling, an outage, a dropped
      // socket — is a "not right now", and losing the message over it is the
      // bug this queue exists to fix.
      if (!isRetryableSendError(error)) {
        throw new SendError(describeError(error), 502);
      }
      status = "queued";
      queuedReason = describeError(error);
      queueAfterWrite = { attempts: 1, dueAt: new Date(Date.now() + backoffMs(1)) };
    }
  }

  const waiting = status === "scheduled" || status === "queued";

  /* ---------------------------------------------------------------------- */
  /* Write it down                                                          */
  /* ---------------------------------------------------------------------- */

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
  const now = new Date();
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
    deliveryStatus: (waiting ? "queued" : status) as DeliveryStatus,
    deliveryError: queuedReason,
    apiKeyId: input.apiKeyId ?? null,
    isTest: Boolean(input.testMode),
    scheduledAt: due,
    sizeBytes: raw.byteLength,
    // A message that has not gone out has not been sent, whatever folder it
    // is filed under. Anything counting sends reads this column.
    sentAt: waiting ? null : now,
    receivedAt: now,
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

  /* ---------------------------------------------------------------------- */
  /* Say what happened                                                      */
  /* ---------------------------------------------------------------------- */

  const context: SentContext = {
    orgId: input.orgId,
    messageId,
    threadId,
    mailboxId: box.id,
    mailboxAddress: box.address,
    rfcMessageId,
    to: input.to,
    cc: input.cc ?? [],
    subject: input.subject,
    apiKeyId: input.apiKeyId ?? null,
    isTest: Boolean(input.testMode),
  };

  if (queueAfterWrite) {
    await enqueueSend({
      orgId: input.orgId,
      messageId,
      mailboxId: box.id,
      fromAddress: box.address,
      recipients: envelope,
      raw,
      dueAt: queueAfterWrite.dueAt,
      attempts: queueAfterWrite.attempts,
      lastError: queuedReason,
    });
    // Nothing has gone out, so there is no email.sent to send. The browser is
    // still told, because a scheduled message should appear in Sent at once.
    await publish({
      type: "mail:changed",
      orgId: input.orgId,
      mailboxId: box.id,
      threadId,
    });
  } else {
    await announceSent(context, sesMessageId, now);

    if (simulated) await recordSimulated(context, simulated, now);
  }

  return {
    threadId,
    messageId,
    sesMessageId,
    rfcMessageId,
    status,
    scheduledAt: due,
    queuedReason,
  };
}
