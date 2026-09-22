/**
 * Which half of the app a screen is being rendered in.
 *
 * Several screens — the email log, blocked addresses, domains — are shared
 * between the inbox side and the campaigns side. A link inside one of them
 * that always pointed at /settings would throw somebody working on a
 * broadcast into the other half of the app and lose their place.
 *
 * Deriving it from the path rather than passing it down keeps the shared
 * components usable from either side without every page having to remember to
 * say where it is.
 */
export function sectionBase(pathname: string) {
  return pathname.startsWith("/campaigns") ? "/campaigns" : "/settings";
}
