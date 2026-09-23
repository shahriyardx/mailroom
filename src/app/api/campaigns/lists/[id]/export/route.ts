import { exportMembers, findList } from "@/server/campaigns";
import { requireCapability } from "@/server/permissions";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A filename a person can find again on their own desktop. */
function slug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "list"
  );
}

/**
 * A list, or a segment of one, as a CSV the browser downloads.
 *
 * A route rather than a server action because the answer is a file. An action
 * would have to hand the whole thing back through the page and build a blob
 * in the browser to save it, which puts a copy of somebody's entire audience
 * into a JavaScript string for no reason.
 *
 * Signed in rather than API-keyed: this is the download button on the list's
 * own page. `GET /api/v1/lists` is where a key belongs.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCapability("mail:send");
  const { id } = await params;

  const list = await findList(access.orgId, id);
  if (!list) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const segmentId = request.nextUrl.searchParams.get("segment");

  let body: string;
  try {
    body = await exportMembers(access.orgId, id, segmentId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "That could not be exported" },
      { status: 400 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug(list.name)}-${today}.csv"`,
      // Somebody's audience is not something a proxy should be keeping.
      "Cache-Control": "no-store",
    },
  });
}
