import { Toaster } from "@/components/kit";
import { CampaignsShell } from "@/components/mail/campaigns-shell";
import { ThemeSync } from "@/components/mail/theme-sync";
import { requireAccess } from "@/server/access";
import { getAppearance } from "@/server/preferences";
import { needsSetup, workspaceSettings } from "@/server/workspace";
import { notFound, redirect } from "next/navigation";

export default async function CampaignsLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  if (await needsSetup(access.orgId)) redirect("/setup");

  const settings = await workspaceSettings(access.orgId);
  // Switched off means these screens do not exist, not that they are hidden.
  if (!settings.campaignsEnabled) notFound();

  const look = await getAppearance(access.userId);

  return (
    <>
      <ThemeSync theme={look.theme} />
      <CampaignsShell
        user={{ name: access.name ?? access.email, email: access.email }}
        showSwitcher={settings.inboxEnabled}
        title="Campaigns"
      >
        {children}
      </CampaignsShell>
      <Toaster />
    </>
  );
}
