import { CampaignsOverviewPanel } from "@/components/mail/campaigns-overview";
import { requireAccess } from "@/server/access";
import { readableLists } from "@/server/campaign-access";
import { campaignsOverview } from "@/server/campaigns";

export const dynamic = "force-dynamic";

export default async function CampaignsHomePage() {
  const access = await requireAccess();
  const overview = await campaignsOverview(access.orgId, await readableLists(access));
  return <CampaignsOverviewPanel overview={overview} />;
}
