import { PUBLIC_HEADERS, publicPage, safe } from "@/lib/public-page";
import {
  type Preference,
  applyPreferences,
  preferencesFor,
  readPreferencesToken,
} from "@/server/campaigns";
import { NextResponse } from "next/server";

/**
 * What somebody gets from you, and the switches to change it.
 *
 * The alternative to this page is an unsubscribe link that is all or nothing,
 * and somebody who only wanted the monthly letter rather than every release
 * note has no way to say so — so they leave entirely, or they press the spam
 * button, which costs the deliverability of everybody else on the list.
 *
 * No sign-in, like every other page here a stranger sees. A plain form with
 * checkboxes and no JavaScript, so it works in whatever browser a mail client
 * decides to open.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

function form(address: string, lists: Preference[], saved: boolean) {
  const rows = lists
    .map((row) => {
      const id = `l_${safe(row.memberId)}`;
      const note = row.locked
        ? `<span class="quiet">Mail to you bounced or was reported, so this one cannot be turned back on here.</span>`
        : row.description
          ? `<span class="quiet">${safe(row.description)}</span>`
          : "";

      return `<label class="pick" for="${id}">
        <input type="checkbox" id="${id}" name="keep" value="${safe(row.memberId)}"
               ${row.on ? "checked" : ""} ${row.locked ? "disabled" : ""}>
        <span>
          <strong>${safe(row.listName)}</strong>
          ${note ? `<br>${note}` : ""}
        </span>
      </label>`;
    })
    .join("");

  return `<h1>Your email preferences</h1>
    <p class="quiet">For <strong>${safe(address)}</strong>.</p>
    ${saved ? `<p class="good">Saved. That is what you will get from now on.</p>` : ""}
    <form method="post">
      ${rows}
      <button type="submit">Save preferences</button>
    </form>
    <p class="quiet" style="margin-top:16px">Clear every box to stop all of it. This never
    affects a message somebody sends you directly.</p>`;
}

/** The extra rules a page of checkboxes needs and the others do not. */
const EXTRA = `<style>
  .pick { display: flex; gap: 10px; align-items: flex-start; margin: 14px 0; }
  .pick input { width: auto; margin-top: 3px; flex: none; }
  .pick span { font-size: 14px; }
  .good { color: #16a34a; font-size: 13px; }
</style>`;

function answer(
  found: { address: string; brandName: string | null; lists: Preference[] } | null,
  saved: boolean,
) {
  if (!found) {
    return new NextResponse(
      publicPage(
        "Link expired",
        `<h1>That link has expired</h1>
         <p>We could not find the subscription it points at.</p>
         <p class="quiet">If you are still getting mail, reply to it and ask to be taken off.</p>`,
      ),
      { status: 404, headers: PUBLIC_HEADERS },
    );
  }

  return new NextResponse(
    publicPage(
      "Your email preferences",
      EXTRA + form(found.address, found.lists, saved),
      found.brandName,
    ),
    { status: 200, headers: PUBLIC_HEADERS },
  );
}

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const id = readPreferencesToken(token);
  return answer(id ? await preferencesFor(id) : null, false);
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const id = readPreferencesToken(token);
  if (!id) return answer(null, false);

  /*
   * An unchecked checkbox sends nothing, so the boxes that came back are the
   * whole answer: anything of theirs missing from it is switched off. That is
   * why "stop everything" needs no button of its own — it is an empty form.
   */
  const body = await request.formData();
  const keep = body.getAll("keep").map(String);

  return answer(await applyPreferences(id, keep), true);
}
