import { ListsPanel } from "@/components/mail/lists-panel";
import { requireAccess } from "@/server/access";
import { campaignReach, readableLists } from "@/server/campaign-access";
import { listsView } from "@/server/campaigns";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ListsPage() {
  const access = await requireAccess();
  const reach = await campaignReach(access);
  // Nothing granted and nothing to grant: the screen does not exist for them.
  if (!reach.everything && !reach.canCreate && reach.rights.size === 0) notFound();

  const lists = await listsView(access.orgId, await readableLists(access));
  return <ListsPanel lists={lists} canCreate={reach.canCreate} />;
}
