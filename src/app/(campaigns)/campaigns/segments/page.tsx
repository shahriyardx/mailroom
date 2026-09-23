import { SegmentsPanel } from "@/components/mail/segments-panel";
import { listsView } from "@/server/campaigns";
import { requireCapability } from "@/server/permissions";
import { segmentsView } from "@/server/segments";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  const access = await requireCapability("rules:manage");

  const [segments, lists] = await Promise.all([
    segmentsView(access.orgId),
    listsView(access.orgId),
  ]);

  return (
    <SegmentsPanel
      segments={segments}
      lists={lists.map((entry) => ({
        id: entry.id,
        name: entry.name,
        subscribed: entry.subscribed,
      }))}
    />
  );
}
