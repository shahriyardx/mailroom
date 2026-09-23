import { CampaignReport } from "@/components/mail/campaign-report";
import { BroadcastBuilder } from "@/components/mail/template-builder";
import { broadcastReport, findBroadcast, listsView, sendableMailboxes } from "@/server/campaigns";
import { requireCapability } from "@/server/permissions";
import { segmentsView } from "@/server/segments";
import { workspaceSettings } from "@/server/workspace";
import { notFound } from "next/navigation";

// Written out rather than re-exported: Next reads this at build time and only
// understands a literal here.
export const dynamic = "force-dynamic";

/*
 * One campaign — either the thing being written, or the record of what it did.
 *
 * The same URL for both, because they are the same object at two points in its
 * life and nobody wants to learn two addresses for it. A draft opens in the
 * builder; anything that has started opens as a report, since what went out is
 * what went out and an editor over it would be offering to change history.
 */
export default async function BroadcastPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireCapability("mail:send");
  const { id } = await params;

  const row = await findBroadcast(access.orgId, id);
  if (!row) notFound();

  if (row.status !== "draft") {
    const report = await broadcastReport(access.orgId, id);
    if (!report) notFound();
    return <CampaignReport report={report} basePath="/campaigns/broadcasts" />;
  }

  const [lists, segments, mailboxes, settings] = await Promise.all([
    listsView(access.orgId),
    segmentsView(access.orgId),
    sendableMailboxes(access.orgId),
    workspaceSettings(access.orgId),
  ]);

  return (
    <BroadcastBuilder
      broadcast={row}
      campaign={{
        lists: lists.map((entry) => ({
          id: entry.id,
          name: entry.name,
          subscribed: entry.subscribed,
        })),
        segments: segments.map((entry) => ({
          id: entry.id,
          listId: entry.listId,
          name: entry.name,
          size: entry.size,
        })),
        mailboxes,
        postalAddress: settings.postalAddress,
      }}
      basePath="/campaigns/broadcasts"
    />
  );
}
