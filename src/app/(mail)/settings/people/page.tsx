import { PeoplePanel } from "@/components/mail/people-panel";
import { requireCapability } from "@/server/permissions";
import { can } from "@/server/permissions";
import { listPeople } from "@/server/team";

export const dynamic = "force-dynamic";

export default async function PeopleSettingsPage() {
  const access = await requireCapability("member:manage");
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
