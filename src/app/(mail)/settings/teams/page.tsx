import { TeamsPanel } from "@/components/mail/teams-panel";
import { requireAccess } from "@/server/access";
import { can } from "@/server/permissions";
import { listPeople } from "@/server/team";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TeamsSettingsPage() {
  const access = await requireAccess();

  // Administrators run every team. A lead is here to run their own.
  const administers = can(access, "member:manage");
  if (!administers && access.leadsTeamIds.length === 0) notFound();

  const { people, teams } = await listPeople();

  return (
    <TeamsPanel
      people={people}
      teams={teams}
      canManage={administers}
      leadsTeamIds={access.leadsTeamIds}
    />
  );
}
