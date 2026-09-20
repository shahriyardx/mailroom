import { OverviewPanel } from "@/components/mail/overview-panel";
import { getAccountStatus } from "@/lib/ses";
import { requireUser } from "@/lib/session";
import { OVERVIEW_WINDOW_DAYS, overview } from "@/server/analytics";

export const dynamic = "force-dynamic";

export default async function OverviewSettingsPage() {
  const user = await requireUser();
  const [data, account] = await Promise.all([
    overview(user.id),
    // SES is a network call that can fail; the rest of the page does not need it.
    getAccountStatus().catch(() => null),
  ]);

  return <OverviewPanel data={data} windowDays={OVERVIEW_WINDOW_DAYS} account={account} />;
}
