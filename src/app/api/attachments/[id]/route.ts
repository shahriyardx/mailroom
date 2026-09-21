import { signedDownloadUrl } from "@/lib/r2";
import { getAccess } from "@/server/access";
import { readableMailboxIds } from "@/server/grants";
import { getAttachmentForUser } from "@/server/threads";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const file = await getAttachmentForUser(access.orgId, id, await readableMailboxIds(access));
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = await signedDownloadUrl(file.r2Key, file.filename);
  return NextResponse.redirect(url, 302);
}
