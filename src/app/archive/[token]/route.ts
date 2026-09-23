import { merge } from "@/lib/campaign-body";
import { archivedBroadcast, readArchiveToken } from "@/server/campaigns";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The subject is written by a person, and it lands in markup twice. */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Enough of a page to hold an email that expects to be the whole window. */
function page(subject: string, body: string, sentAt: Date | null) {
  const when = sentAt
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(sentAt)
    : null;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Not indexed. This is somebody's newsletter, not a page they asked to
     publish, and a campaign turning up in a search result is a surprise. -->
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(subject)}</title>
<style>
  body { margin: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .bar { padding: 14px 16px; text-align: center; font-size: 13px; color: #6b7280; }
</style>
</head>
<body>
<div class="bar">${escapeHtml(subject)}${when ? ` &middot; ${when}` : ""}</div>
${body}
</body>
</html>`;
}

/**
 * The web copy of a campaign, for whoever follows the link in one.
 *
 * No sign-in, because the people who need this are by definition not users of
 * your instance — their mail client refused to load the images, or the layout
 * collapsed, and asking them to make an account to read a newsletter they
 * already received is not a thing anybody would do.
 *
 * The token is signed rather than stored, so one dug out of a year-old email
 * still works. Nothing personal is in it: this is the link most likely to be
 * forwarded, and it must be safe when it is.
 */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const id = readArchiveToken(token);
  // A bad signature and a campaign that was never sent answer the same way.
  // Telling them apart is a way to find out which broadcast ids exist.
  const found = id ? await archivedBroadcast(id) : null;
  if (!found) return new NextResponse("Not found", { status: 404 });

  /*
   * Merged against nobody. The placeholders resolve to their fallbacks — a
   * greeting says "there" — because there is no recipient here and there is
   * not meant to be one.
   */
  const body = merge(found.html, { address: "", name: null }, true).replaceAll(
    "{{unsubscribe}}",
    "#",
  );

  return new NextResponse(page(found.subject, body, found.sentAt), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "public, max-age=300",
    },
  });
}
