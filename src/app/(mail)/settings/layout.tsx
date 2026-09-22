import { SettingsShell } from "@/components/mail/settings-shell";
import { requireAccess } from "@/server/access";
import { mailboxAdministration } from "@/server/grants";
import { CAPABILITIES, can } from "@/server/permissions";
import { workspaceSettings } from "@/server/workspace";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  const settings = await workspaceSettings(access.orgId);
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
    >
      {children}
    </SettingsShell>
  );
}
