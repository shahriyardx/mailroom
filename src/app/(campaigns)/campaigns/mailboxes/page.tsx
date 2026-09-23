/*
 * The same screen as Settings → mailboxes, inside the campaigns shell.
 *
 * Imported rather than copied: one page, two routes, no second copy to drift.
 *
 * It is here because a campaign has to come from an address, and an instance
 * running only the campaigns view has no inbox navigation to find one in — so
 * "add a mailbox first" was advice with nowhere to act on it.
 */
export { default, dynamic } from "@/app/(mail)/settings/mailboxes/page";
