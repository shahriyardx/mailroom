/**
 * Which half of the app somebody was in before they opened settings.
 *
 * Settings is shared by both views and has one way out, so that way out has
 * to know where it is going. An instance running one half has only one
 * answer; an instance running both has to remember, because "back" meaning
 * "back to the other half" is not back.
 *
 * A cookie rather than local storage so the link is right in the first paint
 * the server sends. It holds one of two words and nothing else — there is
 * nothing here worth protecting, only somewhere worth returning to.
 */

export const VIEW_COOKIE = "mailroom_view";

export type View = "mail" | "campaigns";

/** A year. Long enough that a habit survives; short enough to lapse. */
const MAX_AGE = 60 * 60 * 24 * 365;

export function readView(value: string | null | undefined): View | null {
  return value === "mail" || value === "campaigns" ? value : null;
}

/** Called by whichever shell is on screen. No-op anywhere without a document. */
export function rememberView(view: View) {
  if (typeof document === "undefined") return;
  document.cookie = `${VIEW_COOKIE}=${view}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}

/**
 * Where the way out of settings goes, and what it should say.
 *
 * The remembered view only decides it when both halves are on and both are
 * therefore real places. A remembered view that has since been switched off
 * is a door to a room that no longer exists.
 */
export function wayOut(
  features: { inbox: boolean; campaigns: boolean },
  remembered: View | null,
): { href: string; label: string } {
  const campaigns = { href: "/campaigns", label: "Back to campaigns" };
  const mail = { href: "/mail/all/inbox", label: "Back to mail" };

  if (!features.inbox && features.campaigns) return campaigns;
  if (!features.campaigns) return mail;
  return remembered === "campaigns" ? campaigns : mail;
}
