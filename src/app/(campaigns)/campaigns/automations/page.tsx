import { AutomationsPanel } from "@/components/mail/automations-panel";
import { automationsView } from "@/server/automations";
import { readableLists } from "@/server/campaign-access";
import { listsView, sendableMailboxes } from "@/server/campaigns";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const access = await requireCapability("mail:send");
  const only = await readableLists(access);

  const [automations, lists, mailboxes] = await Promise.all([
    automationsView(access.orgId, only),
    listsView(access.orgId, only),
    sendableMailboxes(access.orgId),
  ]);

  return (
    <AutomationsPanel
      automations={automations}
      lists={lists.map((entry) => ({
        id: entry.id,
        name: entry.name,
        subscribed: entry.subscribed,
      }))}
      mailboxes={mailboxes}
    />
  );
}
