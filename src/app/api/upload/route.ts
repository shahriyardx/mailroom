import { db } from "@/db";
import { attachment } from "@/db/schema";
import { putObject } from "@/lib/r2";
import { getSession } from "@/lib/session";
import { newId } from "@/lib/utils";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;

/** Stages composer attachments in R2 before the message exists. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "no files" }, { status: 400 });

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_BYTES) {
    return NextResponse.json({ error: "attachments exceed 25 MB" }, { status: 413 });
  }

  const saved = [];
  for (const file of files) {
    const id = newId("att");
    const key = `staged/${session.user.id}/${id}/${file.name}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await putObject(key, bytes, file.type || "application/octet-stream");

    await db.insert(attachment).values({
      id,
      messageId: null,
      uploadedBy: session.user.id,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      r2Key: key,
    });

    saved.push({ id, filename: file.name, sizeBytes: file.size, contentType: file.type });
  }

  return NextResponse.json({ attachments: saved });
}
