import { DomainPanel, type DomainRow } from "@/components/mail/domain-panel";
import { readQuota } from "@/lib/quota";
import { getAccountStatus } from "@/lib/ses";
import { ensureDomainsSynced, recordsForDomain } from "@/server/domains";
import { requireCapability } from "@/server/permissions";
import { oldestSendInWindow } from "@/server/quota";

export const dynamic = "force-dynamic";

export default async function DomainsSettingsPage() {
  const access = await requireCapability("domain:manage");

  // Domains auto-import on first visit, and refresh when the cached status is stale.
  const sync = await ensureDomainsSynced(access.orgId);
  // Not required for the list, so a failure here must not take the page
  // down with it.
  const account = await getAccountStatus().catch(() => null);

  // Only worth asking when the answer would be shown: well under the cap,
  // when headroom comes back is not a question anybody has.
  const quota = account ? readQuota(account) : null;
  const oldestSend = quota?.tight ? await oldestSendInWindow(access.orgId).catch(() => null) : null;

  const domains: DomainRow[] = sync.rows.map((row) => ({
    ...row,
    records: recordsForDomain(row),
  }));

  return (
    <DomainPanel
      domains={domains}
      account={account}
      oldestSend={oldestSend}
      syncError={sync.ok ? undefined : sync.error}
    />
  );
}
