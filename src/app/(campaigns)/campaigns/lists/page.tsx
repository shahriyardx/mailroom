import { ListsPanel } from "@/components/mail/lists-panel";
import { listsView } from "@/server/campaigns";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const access = await requireCapability("rules:manage");
  const lists = await listsView(access.orgId);
  return <ListsPanel lists={lists} />;
}
