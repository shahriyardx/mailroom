import { db } from "@/db";
import { attachment, message } from "@/db/schema";
import { boolOf, fail, ok } from "@/lib/api-http";
import { getObject, signedDownloadUrl } from "@/lib/r2";
import { apiRoute, callerMailboxIds } from "@/server/api-auth";
import { serializeAttachment } from "@/server/api-serialize";
import { and, eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long a download link stays good. Long enough to fetch, short enough to lose. */
const LINK_SECONDS = 300;

/**
 * GET /api/v1/attachments/:id
 *
 * Returns the file's details and a short-lived `download_url`. Add
 * `?download=true` to get the bytes back directly instead, which saves a
 * second request when the file is small.
 */
export const GET = apiRoute<{ id: string }>("mail:read", async ({ caller, params, url }) => {
  const mailboxIds = await callerMailboxIds(caller);
  if (mailboxIds.length === 0) return fail("not_found", "No such attachment");

  // Joined through the message, so an attachment is only reachable by way of
  // mail this key may read. Staged uploads, which have no message yet, are
  // deliberately not reachable at all.
  const [row] = await db
    .select({ file: attachment })
    .from(attachment)
    .innerJoin(message, eq(message.id, attachment.messageId))
    .where(and(eq(attachment.id, params.id), inArray(message.mailboxId, mailboxIds)))
    .limit(1);

  if (!row) return fail("not_found", "No such attachment");

  if (boolOf(url, "download")) {
    const object = await getObject(row.file.r2Key);
    const bytes = await object.Body?.transformToByteArray();
    if (!bytes) return fail("not_found", "The file could not be read");
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": row.file.contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  }

  const link = await signedDownloadUrl(row.file.r2Key, row.file.filename, LINK_SECONDS);

  return ok({
    ...serializeAttachment(row.file),
    download_url: link,
    download_url_expires_in: LINK_SECONDS,
  });
});
