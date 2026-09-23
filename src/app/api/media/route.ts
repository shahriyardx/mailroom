import { MAX_BYTES, isAllowedType, listMedia, mediaUrl, storeMedia } from "@/server/media";
import { requireCapability } from "@/server/permissions";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** What the library already holds. */
export async function GET() {
  const access = await requireCapability("rules:manage");
  const rows = await listMedia(access.orgId);
  return NextResponse.json({
    media: rows.map((row) => ({ ...row, url: mediaUrl(row.id) })),
  });
}

/**
 * Takes an upload straight into R2.
 *
 * A route rather than a server action because a server action carries its
 * payload through the React protocol, and a ten-megabyte picture has no
 * business being encoded into a form submission to get across.
 */
export async function POST(request: NextRequest) {
  const access = await requireCapability("rules:manage");

  const form = await request.formData();
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "no files" }, { status: 400 });

  const saved = [];
  for (const file of files) {
    const type = file.type || "application/octet-stream";

    if (!isAllowedType(type)) {
      // Anything that can run is refused by type rather than by extension:
      // an .png that is really a script is still a script.
      return NextResponse.json(
        { error: `${file.name} is not a kind of file mail can show` },
        {
          status: 415,
        },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `${file.name} is over 10 MB` }, { status: 413 });
    }

    const row = await storeMedia({
      orgId: access.orgId,
      userId: access.userId,
      filename: file.name,
      contentType: type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });

    saved.push({ ...row, url: mediaUrl(row.id) });
  }

  return NextResponse.json({ media: saved });
}
