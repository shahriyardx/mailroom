import { PeoplePanel } from "@/components/mail/people-panel";
import { requireAccess } from "@/server/access";
import { listDomainsForUser } from "@/server/domains";
import { listMailboxes } from "@/server/mailboxes";
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

  // Which address an invitation may go out from. Only a domain that is
  // verified and enabled for sending can carry one, so the rest are not
  // offered; an invitation from an address that cannot send is a bounce.
  const [boxes, domains] = administers
    ? await Promise.all([listMailboxes(access.orgId), listDomainsForUser(access.orgId)])
    : [[], []];
  const senders = boxes
    .filter((box) =>
      domains.some(
        (item) => item.name === box.domain && item.sendingEnabled && item.status === "verified",
      ),
    )
    .map((box) => ({ id: box.id, address: box.address, isDefault: box.isDefault }));

  return (
    <PeoplePanel
      people={people}
      pending={pending}
      teams={teams}
      me={{ userId: access.userId, role: access.role }}
      senders={senders}
      canManage={administers}
      leadsTeamIds={access.leadsTeamIds}
    />
  );
}
