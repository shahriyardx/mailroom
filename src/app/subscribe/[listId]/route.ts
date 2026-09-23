import { EMBED_HEADERS, PUBLIC_HEADERS, publicPage, safe } from "@/lib/public-page";
import { publicList, subscribe } from "@/server/campaigns";
import { workspaceSettings } from "@/server/workspace";
import { NextResponse } from "next/server";

/**
 * The hosted signup form.
 *
 * A plain HTML form that posts to itself. No JavaScript, because this is the
 * page embedded in somebody's footer or linked from a tweet, and it has to
 * work wherever it lands — and because a signup form is the one thing on the
 * internet that genuinely does not need a framework.
 *
 * A list that has not been given a signup page returns 404 rather than an
 * explanation. Confirming which list ids exist to anybody who guesses is not
 * information worth handing out.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ listId: string }> };

/**
 * Whether this is the copy that lives in an iframe on somebody's own site.
 *
 * A query flag rather than a second route, because the form posts to itself
 * and a form with no `action` keeps the query string — so the answer page
 * stays inside the frame without anything having to carry the flag along.
 */
function embedded(request: Request) {
  return new URL(request.url).searchParams.get("embed") === "1";
}

function form(list: { id: string; name: string; description: string | null }, problem?: string) {
  return `<h1>${safe(list.name)}</h1>
    ${list.description ? `<p>${safe(list.description)}</p>` : ""}
    <form method="post">
      <label for="address">Email address</label>
      <input id="address" name="address" type="email" required autocomplete="email"
             placeholder="you@example.com">
      <label for="name">Name <span class="quiet">(optional)</span></label>
      <input id="name" name="name" type="text" autocomplete="name">
      <button type="submit">Subscribe</button>
      ${problem ? `<p class="bad">${safe(problem)}</p>` : ""}
    </form>
    <p class="quiet" style="margin-top:16px">Every email we send carries a one-click link to
    leave again.</p>`;
}

export async function GET(request: Request, { params }: Params) {
  const { listId } = await params;
  const list = await publicList(listId);
  if (!list) return new NextResponse("Not found", { status: 404 });

  const inFrame = embedded(request);
  const { brandName } = await workspaceSettings(list.organizationId);
  // The brand line is the host page's job when this is on the host's page.
  return new NextResponse(publicPage(list.name, form(list), inFrame ? null : brandName, inFrame), {
    status: 200,
    headers: inFrame ? EMBED_HEADERS : PUBLIC_HEADERS,
  });
}

export async function POST(request: Request, { params }: Params) {
  const { listId } = await params;
  const list = await publicList(listId);
  if (!list) return new NextResponse("Not found", { status: 404 });

  const inFrame = embedded(request);
  const { brandName } = await workspaceSettings(list.organizationId);
  const brand = inFrame ? null : brandName;
  const headers = inFrame ? EMBED_HEADERS : PUBLIC_HEADERS;
  const body = await request.formData();
  const address = String(body.get("address") ?? "");
  const name = String(body.get("name") ?? "").trim() || null;

  let outcome: Awaited<ReturnType<typeof subscribe>>;
  try {
    outcome = await subscribe(list.organizationId, listId, { address, name }, "signup form");
  } catch (error) {
    return new NextResponse(
      publicPage(
        list.name,
        form(list, error instanceof Error ? error.message : "That did not work"),
        brand,
        inFrame,
      ),
      { status: 400, headers },
    );
  }

  /*
   * Every answer is a page rather than a redirect, and none of them says
   * whether the address was already there.
   *
   * "You are already subscribed" on a public form is a way to find out
   * whether somebody's address is on a list, one guess at a time.
   */
  const said =
    outcome.status === "pending"
      ? `<h1>Check your email</h1>
         <p>A confirmation link is on its way to <strong>${safe(address)}</strong>.</p>
         <p class="quiet">Nothing is sent until you click it. If it does not arrive in a few
         minutes, look in the spam folder.</p>`
      : outcome.status === "blocked"
        ? `<h1>We cannot add that address</h1>
           <p>Mail to <strong>${safe(address)}</strong> has bounced or been reported before.</p>
           <p class="quiet">Get in touch if you think that is wrong.</p>`
        : `<h1>You are subscribed</h1>
           <p><strong>${safe(address)}</strong> is on ${safe(list.name)}.</p>
           <p class="quiet">Every email carries a one-click link to leave again.</p>`;

  return new NextResponse(publicPage(list.name, said, brand, inFrame), {
    status: 200,
    headers,
  });
}
