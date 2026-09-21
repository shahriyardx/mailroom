import { db } from "@/db";
import { mailbox, message, messageEvent, suppression } from "@/db/schema";
import { type SnsEnvelope, verifySnsMessage } from "@/lib/sns";
import { newId } from "@/lib/utils";
import { eq } from "drizzle-orm";
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
  deliveryDelay?: { delayType?: string };
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
    occurredAt: new Date(
      event.bounce?.timestamp ??
        event.complaint?.timestamp ??
        event.delivery?.timestamp ??
        event.mail?.timestamp ??
        Date.now(),
    ),
  });

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

  return NextResponse.json({ ok: true });
}
