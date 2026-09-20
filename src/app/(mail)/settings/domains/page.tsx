import { DomainPanel, type DomainRow } from "@/components/mail/domain-panel";
import { getAccountStatus } from "@/lib/ses";
import { requireUser } from "@/lib/session";
import { ensureDomainsSynced, recordsForDomain } from "@/server/domains";

export const dynamic = "force-dynamic";

export default async function DomainsSettingsPage() {
  const user = await requireUser();

  // Domains auto-import on first visit, and refresh when the cached status is stale.
  const sync = await ensureDomainsSynced(user.id);
  const account = await getAccountStatus();

  const domains: DomainRow[] = sync.rows.map((row) => ({
    ...row,
    records: recordsForDomain(row),
  }));

  return (
    <DomainPanel domains={domains} account={account} syncError={sync.ok ? undefined : sync.error} />
  );
}
