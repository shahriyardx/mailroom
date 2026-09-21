import "server-only";

import { db } from "@/db";
import { message, messageEvent } from "@/db/schema";
import type { EmailAddress } from "@/lib/mail";
import { SIMULATED_EVENT, type SimulatedOutcome, simulatedOutcome } from "@/lib/test-mode";
import { newId } from "@/lib/utils";
import { eq } from "drizzle-orm";
import { publish } from "./realtime";
import { dispatchWebhooks } from "./webhooks";

/**
 * What happens once a message has gone out, or has run out of chances.
 *
 * Both the immediate path and the queue end here, so a message sent on the
 * first attempt and one sent twenty minutes later leave exactly the same
 * trace: the same row state, the same webhook, the same nudge to any browser
 * watching the mailbox.
 */

export interface SentContext {
  orgId: string;
  messageId: string;
  threadId: string;
  mailboxId: string;
  mailboxAddress: string;
  rfcMessageId: string | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  apiKeyId: string | null;
  isTest: boolean;
}

/** The message reached SES. Records it and tells everyone who is listening. */
export async function markSent(context: SentContext, sesMessageId: string, sentAt = new Date()) {
  await db
    .update(message)
    .set({
      sesMessageId: sesMessageId || null,
      deliveryStatus: "sent",
      deliveryError: null,
      sentAt,
      // A scheduled message has arrived at its time; the field has done its
      // job and leaving it set would make the row read as still pending.
      scheduledAt: null,
    })
    .where(eq(message.id, context.messageId));

  await announceSent(context, sesMessageId, sentAt);
}

/**
 * The telling-everyone half on its own.
 *
 * A message that went out on the first attempt is written as sent in the same
 * insert that creates it, so there is nothing to update — but it still has to
 * reach the browsers and the webhooks the same way a queued one does.
 */
export async function announceSent(
  context: SentContext,
  sesMessageId: string,
  sentAt = new Date(),
) {
  await publish({
    type: "mail:sent",
    orgId: context.orgId,
    mailboxId: context.mailboxId,
    threadId: context.threadId,
  });

  // Fired here rather than from the SES event stream, so it arrives whether
  // or not a configuration set has been set up, and the moment SES accepts
  // the message rather than a second or two later.
  void dispatchWebhooks(
    context.orgId,
    "email.sent",
    { email: emailPayload(context, { status: "sent", sesMessageId, at: sentAt }) },
    { mailboxId: context.mailboxId },
  );
}

/** No attempts left, or SES will never take it. The row says so, and so do the webhooks. */
export async function markFailed(context: SentContext, reason: string) {
  await db
    .update(message)
    .set({ deliveryStatus: "failed", deliveryError: reason.slice(0, 2000), scheduledAt: null })
    .where(eq(message.id, context.messageId));

  await publish({
    type: "mail:changed",
    orgId: context.orgId,
    mailboxId: context.mailboxId,
    threadId: context.threadId,
  });

  void dispatchWebhooks(
    context.orgId,
    "email.failed",
    {
      email: emailPayload(context, { status: "failed", sesMessageId: null, at: new Date() }),
      error: reason.slice(0, 2000),
    },
    { mailboxId: context.mailboxId },
  );
}

/** A scheduled message called off before its time. */
export async function markCanceled(context: SentContext) {
  await db
    .update(message)
    .set({ deliveryStatus: "canceled", scheduledAt: null })
    .where(eq(message.id, context.messageId));

  await publish({
    type: "mail:changed",
    orgId: context.orgId,
    mailboxId: context.mailboxId,
    threadId: context.threadId,
  });

  void dispatchWebhooks(
    context.orgId,
    "email.canceled",
    { email: emailPayload(context, { status: "canceled", sesMessageId: null, at: new Date() }) },
    { mailboxId: context.mailboxId },
  );
}

/**
 * A test send, from the row state through to the webhooks.
 *
 * Used by both the immediate path and the queue: a test message that was
 * scheduled must not reach SES when its turn comes round, and the only thing
 * that tells the worker so is the mark on the message it is carrying.
 */
export async function markSimulated(context: SentContext, at = new Date()) {
  const outcome = simulatedOutcome(context.to[0]?.address ?? "");

  await db
    .update(message)
    .set({
      deliveryStatus: outcome,
      sesMessageId: null,
      deliveryError: null,
      sentAt: at,
      scheduledAt: null,
    })
    .where(eq(message.id, context.messageId));

  await announceSent(context, "", at);
  await recordSimulated(context, outcome, at);
  return outcome;
}

/**
 * The timeline a real send would have grown from the SES event stream,
 * written directly, so a test send reads the same in the interface.
 */
export async function recordSimulated(
  context: SentContext,
  outcome: SimulatedOutcome,
  at = new Date(),
) {
  const types: string[] = ["send", SIMULATED_EVENT[outcome]];

  await db.insert(messageEvent).values(
    types.map((type) => ({
      id: newId("evt"),
      messageId: context.messageId,
      sesMessageId: null,
      type: type as "send",
      recipient: context.to[0]?.address ?? null,
      detail: "Simulated by a test key",
      occurredAt: at,
    })),
  );

  await announceSimulated(context, outcome);
}

/**
 * The event a test send pretends happened next.
 *
 * A test key never reaches SES, so nothing will ever arrive from the event
 * stream to say the message was delivered or bounced. Without this, the one
 * thing test mode is for — pointing a webhook receiver at it and watching what
 * it does — would only ever produce `email.sent`.
 */
export async function announceSimulated(context: SentContext, status: SimulatedOutcome) {
  const event = (
    {
      delivered: "email.delivered",
      bounced: "email.bounced",
      complained: "email.complained",
      delayed: "email.delayed",
    } as const
  )[status];

  // The same shape the SES event stream produces, plus `simulated`. A
  // receiver written against the real event must not have to special-case
  // this one, or testing against it proves nothing.
  void dispatchWebhooks(
    context.orgId,
    event,
    {
      email: emailPayload(context, { status, sesMessageId: null, at: new Date() }),
      recipients: context.to.map((entry) => entry.address),
      detail: "Simulated by a test key",
      occurred_at: new Date().toISOString(),
      simulated: true,
    },
    { mailboxId: context.mailboxId },
  );
}

/** One shape for the `email` object every one of these events carries. */
function emailPayload(
  context: SentContext,
  outcome: { status: string; sesMessageId: string | null; at: Date },
) {
  return {
    id: context.messageId,
    thread_id: context.threadId,
    mailbox_id: context.mailboxId,
    mailbox: context.mailboxAddress,
    ses_message_id: outcome.sesMessageId || null,
    message_id: context.rfcMessageId,
    from: context.mailboxAddress,
    to: context.to,
    cc: context.cc,
    subject: context.subject,
    status: outcome.status,
    api_key_id: context.apiKeyId,
    test: context.isTest,
    sent_at: outcome.at.toISOString(),
  };
}
