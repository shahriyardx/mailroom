import { BroadcastsPanel } from "@/components/mail/broadcasts-panel";
import { readableLists } from "@/server/campaign-access";
import { broadcastsView, listsView, sendableMailboxes } from "@/server/campaigns";
import { requireCapability } from "@/server/permissions";
import { listTemplates } from "@/server/templates";

export const dynamic = "force-dynamic";

export default async function BroadcastsSettingsPage() {
  const access = await requireCapability("mail:send");
  const only = await readableLists(access);

  const [broadcasts, lists, mailboxes, templates] = await Promise.all([
    broadcastsView(access.orgId, only),
    listsView(access.orgId, only),
    sendableMailboxes(access.orgId),
    listTemplates(access.orgId),
  ]);

  return (
    <BroadcastsPanel
      broadcasts={broadcasts}
      lists={lists.map((entry) => ({
        id: entry.id,
        name: entry.name,
        subscribed: entry.subscribed,
      }))}
      mailboxes={mailboxes}
      templates={templates.map((entry) => ({ id: entry.id, name: entry.name }))}
    />
  );
}
