import { db } from "@/db";
import { mailbox, message, messageEvent } from "@/db/schema";
import { authenticateApiKey } from "@/server/api-auth";
import { and, eq, inArray } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/emails/:id — delivery status plus the SES events seen so far. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const caller = await authenticateApiKey(request);
  if (!caller) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }

  const { id } = await context.params;

  const boxes = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(eq(mailbox.organizationId, caller.orgId));

  const row = await db.query.message.findFirst({
    where: and(
      eq(message.id, id),
      inArray(
        message.mailboxId,
        boxes.map((box) => box.id),
      ),
    ),
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const events = await db.query.messageEvent.findMany({
    where: eq(messageEvent.messageId, row.id),
    orderBy: (e, { asc }) => [asc(e.occurredAt)],
  });

  return NextResponse.json({
    id: row.id,
    ses_message_id: row.sesMessageId,
    message_id: row.rfcMessageId,
    from: row.fromAddress,
    to: row.to,
    subject: row.subject,
    status: row.deliveryStatus,
    error: row.deliveryError,
    sent_at: row.sentAt,
    events: events.map((event) => ({
      type: event.type,
      recipient: event.recipient,
      detail: event.detail,
      occurred_at: event.occurredAt,
    })),
  });
}
