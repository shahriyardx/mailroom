import type { Access } from "@/server/access";
import { mailboxAdministration } from "@/server/grants";
import { type Capability, can } from "@/server/permissions";

/** The screens settings can open on, in the order they are offered. */
const LANDING: [Capability, string][] = [
  ["mailbox:manage", "/settings/overview"],
  ["domain:manage", "/settings/domains"],
  ["member:manage", "/settings/people"],
];

/**
 * The settings screen this person should land on. Asked before the link is
 * drawn so the gear goes straight there instead of bouncing through a
 * redirect.
 */
export async function settingsLanding(access: Access) {
  const first = LANDING.find(([capability]) => can(access, capability));
  if (first) return first[1];

  // A grant can put someone in charge of an address, or of adding them to a
  // domain, without making them an administrator. That is the screen they
  // came for.
  const own = await mailboxAdministration(access);
  if (own.any) return "/settings/mailboxes";

  // Anyone else administers nothing, so their settings are their own account.
  return "/settings/account";
}
