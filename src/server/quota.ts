import "server-only";

import { db } from "@/db";
import { mailbox, message } from "@/db/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

/**
 * The earliest message this app sent that is still inside the rolling
 * 24-hour window.
 *
 * SES gives a count but not a timeline, so the only way to say when headroom
 * comes back is to look at our own record of what went out. That is a floor,
 * not the whole truth: anything else sending through the same AWS account in
 * the same region counts against the quota too and is invisible here. It is
 * still the right answer to "when can I send more", and the panel says where
 * the number comes from.
 */
export async function oldestSendInWindow(orgId: string): Promise<Date | null> {
  const boxes = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(eq(mailbox.organizationId, orgId));
  if (boxes.length === 0) return null;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [row] = await db
    .select({ oldest: sql<Date | null>`min(${message.sentAt})` })
    .from(message)
    .where(
      and(
        inArray(
          message.mailboxId,
          boxes.map((box) => box.id),
        ),
        eq(message.isOutbound, true),
        eq(message.isDraft, false),
        gte(message.sentAt, since),
      ),
    );

  return row?.oldest ? new Date(row.oldest) : null;
}
