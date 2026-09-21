import { OverviewPanel } from "@/components/mail/overview-panel";
import { getAccountStatus } from "@/lib/ses";
import { requireAccess } from "@/server/access";
import { OVERVIEW_WINDOW_DAYS, overview } from "@/server/analytics";

export const dynamic = "force-dynamic";

export default async function OverviewSettingsPage() {
  const access = await requireAccess();
  const [data, account] = await Promise.all([
    overview(access.orgId),
    // SES is a network call that can fail; the rest of the page does not need it.
    getAccountStatus().catch(() => null),
  ]);

  return <OverviewPanel data={data} windowDays={OVERVIEW_WINDOW_DAYS} account={account} />;
}
