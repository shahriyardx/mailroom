import { AutomationDetail } from "@/components/mail/automation-detail";
import { env } from "@/lib/env";
import { automationsView, findAutomation, stepTallies } from "@/server/automations";
import { listsView, sendableMailboxes } from "@/server/campaigns";
import { eventsView } from "@/server/custom-events";
import { requireCapability } from "@/server/permissions";
import { segmentsView } from "@/server/segments";
import { listTemplates } from "@/server/templates";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireCapability("mail:send");
  const { id } = await params;

  const row = await findAutomation(access.orgId, id);
  if (!row) notFound();

  const [lists, mailboxes, all, templates, events, segments, tallies] = await Promise.all([
    listsView(access.orgId),
    sendableMailboxes(access.orgId),
    automationsView(access.orgId),
    listTemplates(access.orgId),
    eventsView(access.orgId),
    segmentsView(access.orgId),
    stepTallies(access.orgId, id),
  ]);

  return (
    <AutomationDetail
      automation={row}
      nodes={row.nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        subject: node.subject,
        delayMinutes: node.delayMinutes,
        waitUntil: node.waitUntil,
        config: node.config,
        next: node.next,
        nextElse: node.nextElse,
        // An email with nothing in it would go out blank, which is worse than
        // not going out — so the canvas flags it before it can.
        empty: node.kind === "email" && !node.html && !node.design,
      }))}
      lists={lists.map((entry) => ({
        id: entry.id,
        name: entry.name,
        subscribed: entry.subscribed,
      }))}
      segments={segments.map((entry) => ({
        id: entry.id,
        listId: entry.listId,
        name: entry.name,
        size: entry.size,
      }))}
      events={events.map((entry) => ({
        id: entry.id,
        name: entry.name,
        seenCount: entry.seenCount,
      }))}
      mailboxes={mailboxes}
      templates={templates.map((entry) => ({ id: entry.id, name: entry.name }))}
      tallies={tallies}
      appUrl={env.appUrl}
      running={all.find((entry) => entry.id === id)?.running ?? 0}
    />
  );
}
