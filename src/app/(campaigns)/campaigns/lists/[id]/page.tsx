import { ListDetailPanel } from "@/components/mail/list-detail-panel";
import { env } from "@/lib/env";
import { requireAccess } from "@/server/access";
import { listRights } from "@/server/campaign-access";
import { listsView, membersView } from "@/server/campaigns";
import { segmentsView } from "@/server/segments";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAccess();
  const { id } = await params;

  const rights = await listRights(access, id);
  if (!rights.read) notFound();

  const list = (await listsView(access.orgId, [id])).find((entry) => entry.id === id);
  if (!list) notFound();

  const [members, segments] = await Promise.all([
    membersView(access.orgId, id),
    segmentsView(access.orgId, id),
  ]);

  return (
    <ListDetailPanel
      list={list}
      members={members}
      segments={segments}
      appUrl={env.appUrl}
      canManage={rights.manage}
    />
  );
}
