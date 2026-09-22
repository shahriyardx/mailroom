import { SettingsShell } from "@/components/mail/settings-shell";
import { VIEW_COOKIE, readView } from "@/lib/last-view";
import { requireAccess } from "@/server/access";
import { mailboxAdministration } from "@/server/grants";
import { CAPABILITIES, can } from "@/server/permissions";
import { workspaceSettings } from "@/server/workspace";
import { cookies } from "next/headers";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  const settings = await workspaceSettings(access.orgId);
  // Read here rather than in the shell so the way out is right in the first
  // paint, instead of correcting itself once the browser catches up.
  const cameFrom = readView((await cookies()).get(VIEW_COOKIE)?.value);
  const allowed = Object.keys(CAPABILITIES).filter((capability) =>
    can(access, capability as keyof typeof CAPABILITIES),
  );

  // A grant can let someone change a mailbox or add to a domain without
  // making them an administrator of every mailbox. That opens the mailboxes
  // screen and nothing else, so it is its own key rather than the capability
  // the other screens are gated on.
  // Leading a team is a reason to reach the people screen without being an
  // administrator of the instance.
  if (!allowed.includes("member:manage") && access.leadsTeamIds.length > 0) {
    allowed.push("member:manage");
  }

  if (allowed.includes("mailbox:manage")) {
    allowed.push("mailbox:settings");
  } else {
    const own = await mailboxAdministration(access);
    if (own.any) allowed.push("mailbox:settings");
  }

  return (
    <SettingsShell
      user={{ name: access.name ?? access.email, email: access.email }}
      allowed={allowed}
      features={{ inbox: settings.inboxEnabled, campaigns: settings.campaignsEnabled }}
      cameFrom={cameFrom}
    >
      {children}
    </SettingsShell>
  );
}
