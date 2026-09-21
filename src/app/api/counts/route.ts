import { parseRoute } from "@/lib/scope";
import { getAccess } from "@/server/access";
import { readableMailboxIds } from "@/server/grants";
import { folderCounts, unreadByMailbox } from "@/server/threads";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sidebar badges: folder counts for the active scope plus per-mailbox unread. */
export async function GET(request: NextRequest) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const path = request.nextUrl.searchParams.get("path") ?? "/mail/all/inbox";
  const slug = path
    .replace(/^\/mail\/?/, "")
    .split("/")
    .filter(Boolean);
  const { scope } = parseRoute(slug);

  const allowed = await readableMailboxIds(access);
  const [folders, mailboxes] = await Promise.all([
    folderCounts(access.orgId, scope, allowed),
    unreadByMailbox(access.orgId, allowed),
  ]);

  return NextResponse.json({ folders, mailboxes });
}
