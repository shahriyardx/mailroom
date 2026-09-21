import { PeoplePanel } from "@/components/mail/people-panel";
import { requireAccess } from "@/server/access";
import { can } from "@/server/permissions";
import { listPeople } from "@/server/team";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PeopleSettingsPage() {
  const access = await requireAccess();

  // Administrators run everyone. A team lead is here to run their own team.
  const administers = can(access, "member:manage");
  if (!administers && access.leadsTeamIds.length === 0) notFound();

  const { people, pending, teams } = await listPeople();

  return (
    <PeoplePanel
      people={people}
      pending={pending}
      teams={teams}
      me={{ userId: access.userId, role: access.role }}
      canManage={administers}
      leadsTeamIds={access.leadsTeamIds}
    />
  );
}
