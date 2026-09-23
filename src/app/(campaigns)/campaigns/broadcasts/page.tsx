import { BroadcastsPanel } from "@/components/mail/broadcasts-panel";
import { broadcastsView, listsView, sendableMailboxes } from "@/server/campaigns";
import { requireCapability } from "@/server/permissions";
import { listTemplates } from "@/server/templates";

export const dynamic = "force-dynamic";

export default async function BroadcastsSettingsPage() {
  const access = await requireCapability("mail:send");

  const [broadcasts, lists, mailboxes, templates] = await Promise.all([
    broadcastsView(access.orgId),
    listsView(access.orgId),
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
