import { db } from "@/db";
import { message } from "@/db/schema";
import { fail } from "@/lib/api-http";
import { getObject } from "@/lib/r2";
import { apiRoute, callerMailboxIds } from "@/server/api-auth";
import { and, eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/messages/:id/raw — the message exactly as it arrived.
 *
 * Returned as message/rfc822 so it can be piped straight into a MIME parser,
 * re-sent, or kept for an audit. Only inbound mail has one: outbound mail is
 * assembled at send time and not stored in its wire form.
 */
export const GET = apiRoute<{ id: string }>("mail:read", async ({ caller, params }) => {
  const mailboxIds = await callerMailboxIds(caller);
  if (mailboxIds.length === 0) return fail("not_found", "No such message");

  const row = await db.query.message.findFirst({
    where: and(eq(message.id, params.id), inArray(message.mailboxId, mailboxIds)),
  });
  if (!row) return fail("not_found", "No such message");
  if (!row.rawKey) {
    return fail("not_found", "The original of this message was not kept");
  }

  const object = await getObject(row.rawKey);
  const bytes = await object.Body?.transformToByteArray();
  if (!bytes) return fail("not_found", "The original of this message could not be read");

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "message/rfc822",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${row.id}.eml"`,
      "Cache-Control": "private, no-store",
    },
  });
});
