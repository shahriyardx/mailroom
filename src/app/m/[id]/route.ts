import { getObject } from "@/lib/r2";
import { findMedia } from "@/server/media";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Serves an uploaded file to anybody who has the address.
 *
 * Deliberately unauthenticated. A picture in an email is fetched by whoever
 * opened the message — or by Gmail's image proxy on their behalf — from a
 * machine with no session here, so a check would only ever mean a broken
 * image in somebody's inbox. The id is a random one and it is the whole of
 * the secret, which is the same bargain every hosted image has.
 *
 * Not a redirect to a signed URL, the way an attachment is: a signed link
 * expires, and this address is copied into mail that will be opened long
 * after any signature would have.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const row = await findMedia(id);
  if (!row) return new NextResponse("Not found", { status: 404 });

  const object = await getObject(row.r2Key);
  if (!object.Body) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(object.Body.transformToWebStream(), {
    headers: {
      "content-type": row.contentType,
      "content-length": String(row.sizeBytes),
      // The bytes at an id never change, so it can be held for a year. Caches
      // between here and a reader are the only reason this scales at all.
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
    },
  });
}
