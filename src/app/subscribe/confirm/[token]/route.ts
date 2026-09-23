import { PUBLIC_HEADERS, publicPage, safe } from "@/lib/public-page";
import { confirmByToken } from "@/server/campaigns";
import { NextResponse } from "next/server";

/**
 * The link in a "please confirm" email.
 *
 * A GET with no session, like unsubscribing: whoever clicks this has no
 * account here and asking them to make one would defeat the point of asking
 * them to confirm at all.
 *
 * Clicking twice says the same thing as clicking once. Mail providers run
 * link scanners that follow every URL in a message before the reader sees it,
 * so the second visit is often not even a person.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await confirmByToken(token);

  const body = result
    ? `<h1>${result.fresh ? "You are subscribed" : "Already confirmed"}</h1>
       <p><strong>${safe(result.address)}</strong> is on ${safe(result.listName)}.</p>
       <p class="quiet">Every email carries a link to leave again, and it takes one click.</p>`
    : `<h1>That link has expired</h1>
       <p>We could not find the subscription this link points at.</p>
       <p class="quiet">Sign up again and a fresh link will be sent.</p>`;

  return new NextResponse(publicPage(result ? "Subscribed" : "Link expired", body), {
    status: 200,
    headers: PUBLIC_HEADERS,
  });
}
