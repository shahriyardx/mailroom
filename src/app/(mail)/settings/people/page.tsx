import { PeoplePanel } from "@/components/mail/people-panel";
import { requireAccess } from "@/server/access";
import { can } from "@/server/permissions";
import { listPeople } from "@/server/team";

export const dynamic = "force-dynamic";

export default async function PeopleSettingsPage() {
  const access = await requireAccess();
  const { people, pending, teams } = await listPeople();

  return (
    <PeoplePanel
      people={people}
      pending={pending}
      teams={teams}
      me={{ userId: access.userId, role: access.role }}
      canManage={can(access, "member:manage")}
    />
  );
}
