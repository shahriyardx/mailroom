import { requireAccess } from "@/server/access";
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
  // A member administers nothing, so their settings are their own account.
  redirect(first ? first[1] : "/settings/account");
}
