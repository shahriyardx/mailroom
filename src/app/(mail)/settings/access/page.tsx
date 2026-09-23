import { AccessPanel } from "@/components/mail/access-panel";
import { requireCapability } from "@/server/permissions";
import { listGrants } from "@/server/team";
import { workspaceSettings } from "@/server/workspace";

export const dynamic = "force-dynamic";

export default async function AccessSettingsPage() {
  const access = await requireCapability("access:manage");

  const [grants, settings] = await Promise.all([listGrants(), workspaceSettings(access.orgId)]);

  return (
    <AccessPanel
      mailGrants={grants.mailGrants}
      campaignGrants={grants.campaignGrants}
      teams={grants.teams}
      members={grants.members}
      domains={grants.domains}
      mailboxes={grants.mailboxes}
      lists={grants.lists}
      // A half that is switched off is not a tab; there is nothing under it.
      features={{ inbox: settings.inboxEnabled, campaigns: settings.campaignsEnabled }}
    />
  );
}
