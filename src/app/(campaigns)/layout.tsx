import { Toaster } from "@/components/kit";
import { CampaignsShell } from "@/components/mail/campaigns-shell";
import { ThemeSync } from "@/components/mail/theme-sync";
import { requireAccess } from "@/server/access";
import { CAPABILITIES, can } from "@/server/permissions";
import { getAppearance } from "@/server/preferences";
import { settingsLanding } from "@/server/settings-landing";
import { needsSetup, workspaceSettings } from "@/server/workspace";
import { notFound, redirect } from "next/navigation";

export default async function CampaignsLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  if (await needsSetup(access.orgId)) redirect("/setup");

  const settings = await workspaceSettings(access.orgId);
  // Switched off means these screens do not exist, not that they are hidden.
  if (!settings.campaignsEnabled) notFound();

  const look = await getAppearance(access.userId);
  const settingsHref = await settingsLanding(access);
  const allowed = Object.keys(CAPABILITIES).filter((capability) =>
    can(access, capability as keyof typeof CAPABILITIES),
  );

  return (
    <>
      <ThemeSync theme={look.theme} />
      <CampaignsShell
        user={{ name: access.name ?? access.email, email: access.email }}
        allowed={allowed}
        showSwitcher={settings.inboxEnabled}
        settingsHref={settingsHref}
      >
        {children}
      </CampaignsShell>
      <Toaster />
    </>
  );
}
