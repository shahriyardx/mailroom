import { DomainPanel, type DomainRow } from "@/components/mail/domain-panel";
import { EventsPanel } from "@/components/mail/events-panel";
import { getAccountStatus } from "@/lib/ses";
import { ensureDomainsSynced, recordsForDomain } from "@/server/domains";
import { eventsStatus } from "@/server/events";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function DomainsSettingsPage() {
  const access = await requireCapability("domain:manage");

  // Domains auto-import on first visit, and refresh when the cached status is stale.
  const sync = await ensureDomainsSynced(access.orgId);
  // Neither call is required for the list, so a failure in one must not take
  // the page down with it.
  const [account, events] = await Promise.all([
    getAccountStatus().catch(() => null),
    eventsStatus(),
  ]);

  const domains: DomainRow[] = sync.rows.map((row) => ({
    ...row,
    records: recordsForDomain(row),
  }));

  return (
    <>
      <DomainPanel
        domains={domains}
        account={account}
        syncError={sync.ok ? undefined : sync.error}
      />
      <EventsPanel status={events} />
    </>
  );
}
