import { isNewer } from "@/lib/version";
import { requireAccess } from "@/server/access";

export const runtime = "nodejs";

const RELEASES = "https://api.github.com/repos/shahriyardx/mailroom/releases/latest";

/**
 * Half an hour. Long enough that a busy instance asks GitHub twice an hour
 * however many people are using it, short enough that a release does not sit
 * unannounced for most of a day — which is how a six-hour cache made the
 * notice look broken on the one day anybody was watching for it.
 */
const CACHE_SECONDS = 1_800;

/**
 * GET /api/version — what is running, and whether anything newer was released.
 *
 * The check is made here rather than in the browser so one instance asks once
 * for everybody on it, and so a reader's own address is never handed to a
 * third party. It is off entirely when UPDATE_CHECK=off, because an instance
 * on a private network should not have to reach the internet to render its
 * own sidebar.
 */
export async function GET() {
  // Signed in only. An unauthenticated caller has no business learning which
  // version an instance runs, which is the first thing worth knowing to
  // attack one.
  await requireAccess();

  const current = process.env.APP_VERSION ?? "0.0.0";

  if (process.env.UPDATE_CHECK === "off") {
    return Response.json({ current, latest: null, update_available: false, url: null });
  }

  try {
    const response = await fetch(RELEASES, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(4000),
      next: { revalidate: CACHE_SECONDS },
    });
    if (!response.ok) throw new Error(`GitHub said ${response.status}`);

    const release = (await response.json()) as { tag_name?: string; html_url?: string };
    const latest = release.tag_name?.replace(/^v/, "") ?? null;

    return Response.json({
      current,
      latest,
      update_available: Boolean(latest && isNewer(latest, current)),
      url: release.html_url ?? null,
    });
  } catch {
    // GitHub being unreachable is not worth an error in the sidebar. The
    // version that is running is still worth saying.
    return Response.json({ current, latest: null, update_available: false, url: null });
  }
}
