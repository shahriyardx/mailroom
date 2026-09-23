import { CompanyPanel } from "@/components/mail/company-panel";
import { OverviewPanel } from "@/components/mail/overview-panel";
import { getAccountStatus } from "@/lib/ses";
import { OVERVIEW_WINDOW_DAYS, overview } from "@/server/analytics";
import { requireCapability } from "@/server/permissions";
import { getCompany } from "@/server/team";
import { workspaceSettings } from "@/server/workspace";

export const dynamic = "force-dynamic";

export default async function OverviewSettingsPage() {
  const access = await requireCapability("mailbox:manage");
  const [data, account, { company, canRename }, settings] = await Promise.all([
    overview(access.orgId),
    // SES is a network call that can fail; the rest of the page does not need it.
    getAccountStatus().catch(() => null),
    getCompany(),
    workspaceSettings(access.orgId),
  ]);

  return (
    <>
      {company && (
        <CompanyPanel
          company={company}
          canRename={canRename}
          postalAddress={settings.postalAddress}
          sendRatePerHour={settings.sendRatePerHour}
        />
      )}
      <OverviewPanel data={data} windowDays={OVERVIEW_WINDOW_DAYS} account={account} />
    </>
  );
}
