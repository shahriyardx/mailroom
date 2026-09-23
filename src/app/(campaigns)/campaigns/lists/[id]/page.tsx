import { ListDetailPanel } from "@/components/mail/list-detail-panel";
import { env } from "@/lib/env";
import { listsView, membersView } from "@/server/campaigns";
import { requireCapability } from "@/server/permissions";
import { segmentsView } from "@/server/segments";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireCapability("rules:manage");
  const { id } = await params;

  const list = (await listsView(access.orgId)).find((entry) => entry.id === id);
  if (!list) notFound();

  const [members, segments] = await Promise.all([
    membersView(access.orgId, id),
    segmentsView(access.orgId, id),
  ]);

  return <ListDetailPanel list={list} members={members} segments={segments} appUrl={env.appUrl} />;
}
