import { db } from "@/db";
import {
  automationSend,
  broadcastClick,
  broadcastRecipient,
  mailbox,
  message,
  messageEvent,
  suppression,
} from "@/db/schema";
import { type SnsEnvelope, verifySnsMessage } from "@/lib/sns";
import { newId } from "@/lib/utils";
import { type WebhookEvent, dispatchWebhooks } from "@/server/webhooks";
import { and, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_MAP: Record<string, (typeof messageEvent.type.enumValues)[number]> = {
  Send: "send",
  Delivery: "delivery",
  Bounce: "bounce",
  Complaint: "complaint",
  Reject: "reject",
  Open: "open",
  Click: "click",
  DeliveryDelay: "delivery_delay",
  RenderingFailure: "rendering_failure",
  Subscription: "subscription",
};

/** The public event name each SES notification is passed on under. */
// "Send" is missing on purpose: this app records its own sends and fires
// email.sent there, which works whether or not a configuration set exists.
const WEBHOOK_MAP: Record<string, WebhookEvent> = {
  Delivery: "email.delivered",
  Bounce: "email.bounced",
  Complaint: "email.complained",
  Open: "email.opened",
  Click: "email.clicked",
  Reject: "email.rejected",
  DeliveryDelay: "email.delayed",
};

const STATUS_MAP: Record<string, (typeof message.deliveryStatus.enumValues)[number]> = {
  Send: "sent",
  Delivery: "delivered",
  Bounce: "bounced",
  Complaint: "complained",
  Reject: "rejected",
  DeliveryDelay: "delayed",
  RenderingFailure: "failed",
};

interface SesEvent {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string; timestamp?: string; destination?: string[] };
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: { emailAddress?: string; diagnosticCode?: string }[];
    timestamp?: string;
  };
  complaint?: {
    complainedRecipients?: { emailAddress?: string }[];
    complaintFeedbackType?: string;
    timestamp?: string;
  };
  delivery?: { recipients?: string[]; timestamp?: string };
  deliveryDelay?: { delayType?: string; timestamp?: string };
  subscription?: { timestamp?: string };
  /** SES rewrites the links itself when the configuration set asks it to. */
  click?: { link?: string; timestamp?: string };
  open?: { timestamp?: string };
}

/**
 * When the event itself happened, not when the message was sent.
 *
 * Each kind carries its own time in its own object. The message's send time
 * is only the fallback for the kinds that have none (a send, a reject), and
 * using it for everything put every open and click at the moment the message
 * left, however long afterwards somebody actually opened it.
 */
function whenItHappened(event: SesEvent) {
  return new Date(
    event.bounce?.timestamp ??
      event.complaint?.timestamp ??
      event.delivery?.timestamp ??
      event.open?.timestamp ??
      event.click?.timestamp ??
      event.deliveryDelay?.timestamp ??
      event.subscription?.timestamp ??
      event.mail?.timestamp ??
      Date.now(),
  );
}

/**
 * SNS endpoint for an SES configuration set. Every payload is signature-checked
 * against the AWS signing certificate before anything is written.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();

  let envelope: SnsEnvelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const expectedTopic = process.env.SES_SNS_TOPIC_ARN;
  if (expectedTopic && envelope.TopicArn !== expectedTopic) {
    return NextResponse.json({ error: "unexpected topic" }, { status: 403 });
  }

  if (!(await verifySnsMessage(envelope))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  // First handshake: confirm the subscription by calling the URL AWS supplied.
  if (envelope.Type === "SubscriptionConfirmation" && envelope.SubscribeURL) {
    await fetch(envelope.SubscribeURL).catch(() => {});
    return NextResponse.json({ confirmed: true });
  }

  if (envelope.Type !== "Notification") return NextResponse.json({ ignored: true });

  let event: SesEvent;
  try {
    event = JSON.parse(envelope.Message);
  } catch {
    return NextResponse.json({ error: "invalid event payload" }, { status: 400 });
  }

  const kind = event.eventType ?? event.notificationType ?? "";
  const type = EVENT_MAP[kind];
  const sesMessageId = event.mail?.messageId ?? null;
  if (!type || !sesMessageId) return NextResponse.json({ ignored: true });

  const row = await db.query.message.findFirst({
    where: eq(message.sesMessageId, sesMessageId),
  });

  const recipients =
    event.bounce?.bouncedRecipients?.map((entry) => entry.emailAddress ?? "") ??
    event.complaint?.complainedRecipients?.map((entry) => entry.emailAddress ?? "") ??
    event.delivery?.recipients ??
    event.mail?.destination ??
    [];

  const detail = event.bounce
    ? `${event.bounce.bounceType}/${event.bounce.bounceSubType}`
    : event.complaint
      ? (event.complaint.complaintFeedbackType ?? "complaint")
      : (event.deliveryDelay?.delayType ?? null);

  await db.insert(messageEvent).values({
    id: newId("evt"),
    messageId: row?.id ?? null,
    sesMessageId,
    type,
    recipient: recipients[0] || null,
    detail,
    payload: event as unknown as Record<string, unknown>,
    occurredAt: whenItHappened(event),
  });

  // An open says nothing about delivery status, so it is recorded beside it
  // rather than in it. The first one is what the thread shows; the count is
  // there because a forwarded message keeps being opened.
  if (row && kind === "Open") {
    await db
      .update(message)
      .set({
        openedAt: row.openedAt ?? whenItHappened(event),
        openCount: sql`${message.openCount} + 1`,
      })
      .where(eq(message.id, row.id));
  }

  /*
   * The same open, told to the campaign that caused it.
   *
   * A message row already knows it was opened; a campaign report needs to know
   * how many *people* opened, which is a different table. Stamped rather than
   * counted, because "first opened" is the only moment a report asks about and
   * a forwarded newsletter would otherwise inflate every number on the page.
   *
   * Nothing here builds a redirect of our own. SES rewrites the links, which
   * means there is no URL of ours that has to keep answering forever or every
   * link in every email ever sent breaks.
   */
  if (row && (kind === "Open" || kind === "Click")) {
    const [copy] = await db
      .select({
        id: broadcastRecipient.id,
        broadcastId: broadcastRecipient.broadcastId,
        organizationId: broadcastRecipient.organizationId,
        openedAt: broadcastRecipient.openedAt,
        clickedAt: broadcastRecipient.clickedAt,
      })
      .from(broadcastRecipient)
      .where(eq(broadcastRecipient.messageId, row.id))
      .limit(1);

    if (copy) {
      const when = new Date(
        event.click?.timestamp ?? event.open?.timestamp ?? event.mail?.timestamp ?? Date.now(),
      );

      await db
        .update(broadcastRecipient)
        .set(
          kind === "Click"
            ? // A click is an open by any reasonable reading, and some clients
              // never fire the pixel. Counting it as both is what stops a
              // campaign reporting more clicks than opens.
              { clickedAt: copy.clickedAt ?? when, openedAt: copy.openedAt ?? when }
            : { openedAt: copy.openedAt ?? when },
        )
        .where(eq(broadcastRecipient.id, copy.id));

      const link = event.click?.link;
      if (kind === "Click" && link) {
        await db
          .insert(broadcastClick)
          .values({
            id: newId("bcc"),
            organizationId: copy.organizationId,
            broadcastId: copy.broadcastId,
            recipientId: copy.id,
            url: link.slice(0, 2000),
            firstAt: when,
            lastAt: when,
          })
          .onConflictDoUpdate({
            target: [broadcastClick.recipientId, broadcastClick.url],
            set: { clicks: sql`${broadcastClick.clicks} + 1`, lastAt: when },
          });
      }
    }
  }

  /*
   * The same open or click, told to the automation that sent it.
   *
   * Separate from the campaign copy above because they are different tables
   * answering different questions, and a message belongs to at most one of
   * them. Without this an automation's own mail is invisible to its own
   * conditions — "did they open the last email" would read campaign rows and
   * answer no to everybody in a drip.
   */
  if (row && (kind === "Open" || kind === "Click")) {
    const [sent] = await db
      .select({
        id: automationSend.id,
        openedAt: automationSend.openedAt,
        clickedAt: automationSend.clickedAt,
      })
      .from(automationSend)
      .where(eq(automationSend.messageId, row.id))
      .limit(1);

    if (sent) {
      const when = new Date(
        event.click?.timestamp ?? event.open?.timestamp ?? event.mail?.timestamp ?? Date.now(),
      );

      await db
        .update(automationSend)
        .set(
          kind === "Click"
            ? // A click is an open by any reasonable reading, and some clients
              // never fire the pixel.
              { clickedAt: sent.clickedAt ?? when, openedAt: sent.openedAt ?? when }
            : { openedAt: sent.openedAt ?? when },
        )
        .where(eq(automationSend.id, sent.id));
    }
  }

  const status = STATUS_MAP[kind];
  if (row && status) {
    await db
      .update(message)
      .set({
        deliveryStatus: status,
        deliveryError:
          event.bounce?.bouncedRecipients?.[0]?.diagnosticCode ??
          (event.complaint ? "Recipient marked this as spam" : null),
      })
      .where(eq(message.id, row.id));
  }

  // A permanent bounce or a complaint means we must stop mailing that address.
  const shouldSuppress =
    (kind === "Bounce" && event.bounce?.bounceType === "Permanent") || kind === "Complaint";

  if (shouldSuppress && row) {
    const box = await db.query.mailbox.findFirst({ where: eq(mailbox.id, row.mailboxId) });
    if (box) {
      for (const address of recipients.filter(Boolean)) {
        await db
          .insert(suppression)
          .values({
            id: newId("sup"),
            organizationId: box.organizationId,
            address: address.toLowerCase(),
            reason: kind === "Complaint" ? "complaint" : (detail ?? "permanent bounce"),
          })
          .onConflictDoNothing();
      }
    }
  }

  // Pass it on to whoever asked to hear about it. Not awaited: SNS retries a
  // slow endpoint, and a webhook of our own must not be the reason it does.
  const outward = WEBHOOK_MAP[kind];
  if (outward && row) {
    const box = await db.query.mailbox.findFirst({ where: eq(mailbox.id, row.mailboxId) });
    if (box) {
      void dispatchWebhooks(
        box.organizationId,
        outward,
        {
          email: {
            id: row.id,
            thread_id: row.threadId,
            mailbox_id: row.mailboxId,
            mailbox: box.address,
            ses_message_id: sesMessageId,
            message_id: row.rfcMessageId,
            from: row.fromAddress,
            to: row.to,
            subject: row.subject,
            status: status ?? row.deliveryStatus,
          },
          recipients: recipients.filter(Boolean),
          detail,
          occurred_at: new Date().toISOString(),
        },
        { mailboxId: row.mailboxId },
      );
    }
  }

  return NextResponse.json({ ok: true });
}
