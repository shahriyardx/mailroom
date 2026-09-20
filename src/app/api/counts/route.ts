import { parseRoute } from "@/lib/scope";
import { getSession } from "@/lib/session";
import { folderCounts, unreadByMailbox } from "@/server/threads";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sidebar badges: folder counts for the active scope plus per-mailbox unread. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const path = request.nextUrl.searchParams.get("path") ?? "/mail/all/inbox";
  const slug = path
    .replace(/^\/mail\/?/, "")
    .split("/")
    .filter(Boolean);
  const { scope } = parseRoute(slug);

  const [folders, mailboxes] = await Promise.all([
    folderCounts(session.user.id, scope),
    unreadByMailbox(session.user.id),
  ]);

  return NextResponse.json({ folders, mailboxes });
}
