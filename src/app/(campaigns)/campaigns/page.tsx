import { CampaignsOverviewPanel } from "@/components/mail/campaigns-overview";
import { requireAccess } from "@/server/access";
import { campaignsOverview } from "@/server/campaigns";

export const dynamic = "force-dynamic";

export default async function CampaignsHomePage() {
  const access = await requireAccess();
  const overview = await campaignsOverview(access.orgId);
  return <CampaignsOverviewPanel overview={overview} />;
}
