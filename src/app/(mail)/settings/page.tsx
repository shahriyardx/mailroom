import { requireAccess } from "@/server/access";
import { mailboxAdministration } from "@/server/grants";
import { type Capability, can } from "@/server/permissions";
import { redirect } from "next/navigation";

/** The screens settings can open on, in the order they are offered. */
const LANDING: [Capability, string][] = [
  ["mailbox:manage", "/settings/overview"],
  ["domain:manage", "/settings/domains"],
  ["member:manage", "/settings/people"],
];

export default async function SettingsIndex() {
  const access = await requireAccess();
  const first = LANDING.find(([capability]) => can(access, capability));
  if (first) redirect(first[1]);

  // A grant can put someone in charge of an address, or of adding them to a
  // domain, without making them an administrator. That is the screen they
  // came for.
  const own = await mailboxAdministration(access);
  if (own.any) redirect("/settings/mailboxes");

  // Anyone else administers nothing, so their settings are their own account.
  redirect("/settings/account");
}
