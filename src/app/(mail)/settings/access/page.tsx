import { AccessPanel } from "@/components/mail/access-panel";
import { listGrants } from "@/server/team";

export const dynamic = "force-dynamic";

export default async function AccessSettingsPage() {
  const { grants, teams, members, domains, mailboxes } = await listGrants();

  return (
    <AccessPanel
      grants={grants}
      teams={teams}
      members={members}
      domains={domains}
      mailboxes={mailboxes}
    />
  );
}
