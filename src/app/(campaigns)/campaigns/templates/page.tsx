/*
 * The same screen as Settings → templates, rendered inside the campaigns shell.
 *
 * Re-exported rather than copied: somebody sending broadcasts reaches for
 * these constantly, and being thrown into the other half of the app to look
 * at a domain loses their place. One page, two routes, no second copy to
 * drift.
 */
export { default, dynamic } from "@/app/(mail)/settings/templates/page";
