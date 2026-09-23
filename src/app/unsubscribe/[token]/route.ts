import { preferencesUrl, readUnsubscribeToken, unsubscribeByToken } from "@/server/campaigns";
import { NextResponse } from "next/server";

/**
 * Leaving a list.
 *
 * A route rather than a page, because the same URL has to answer two very
 * different callers. A reader clicking the footer link sends a GET and wants
 * something to look at. Gmail and Yahoo send a POST behind the reader's back
 * when they press the client's own unsubscribe button — that is RFC 8058
 * one-click, and mail without it is refused outright by both.
 *
 * No sign-in, no session, no layout. Somebody unsubscribing is by definition
 * not a user of this instance, and asking them to log in to stop receiving
 * mail is how a complaint becomes a spam report.
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { token } = await params;
  const result = await unsubscribeByToken(token);

  // The mail client shows nothing either way, so the status code is the whole
  // answer. A bad token is still a 200: it means the link is old, not that
  // the reader should be asked to try again.
  return NextResponse.json({ ok: result !== null });
}

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const result = await unsubscribeByToken(token);

  /*
   * Offered after the fact rather than instead of it.
   *
   * Making somebody manage preferences in order to unsubscribe is the trick
   * that produces spam reports. They are off this list before the page loads;
   * the other lists are a thing they may now want to look at.
   */
  const memberId = readUnsubscribeToken(token);

  return new NextResponse(page(result, memberId ? preferencesUrl(memberId) : null), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function safe(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

/**
 * Deliberately one self-contained file with its own styles.
 *
 * It is the only page in this app a stranger sees, it has to render in
 * whatever browser a mail client opens, and it must not depend on the app
 * shell being up. Inlining a few rules is cheaper than any of that going
 * wrong at the moment somebody is already annoyed enough to unsubscribe.
 */
function page(result: { address: string; listName: string } | null, prefsUrl: string | null) {
  const manage = prefsUrl
    ? `<p class="quiet">Still on other lists? <a href="${safe(prefsUrl)}">Choose what you get</a>.</p>`
    : "";

  const body = result
    ? `<h1>You have been unsubscribed</h1>
       <p><strong>${safe(result.address)}</strong> has been removed from
       ${safe(result.listName)}. You will not be sent any more of these.</p>
       <p class="quiet">This does not affect any other list you are on, or any
       message somebody sends you directly.</p>
       ${manage}`
    : `<h1>That link has expired</h1>
       <p>We could not find the subscription this link points at. It may have
       already been removed.</p>
       <p class="quiet">If you are still receiving mail, reply to it and ask to
       be taken off the list.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${result ? "Unsubscribed" : "Link expired"}</title>
<style>
  :root { color-scheme: light dark; --ink: #18181b; --quiet: #71717a; --bg: #fafafa; --card: #fff; --line: #e4e4e7; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #fafafa; --quiet: #a1a1aa; --bg: #09090b; --card: #18181b; --line: #27272a; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px;
         background: var(--bg); color: var(--ink);
         font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 26rem; width: 100%; background: var(--card); border: 1px solid var(--line);
         border-radius: 16px; padding: 28px 24px; }
  h1 { margin: 0 0 12px; font-size: 19px; letter-spacing: -0.02em; }
  p { margin: 0 0 10px; }
  .quiet { color: var(--quiet); font-size: 13px; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
