import { EventsPanel } from "@/components/mail/events-panel";
import { eventsStatus } from "@/server/events";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

/**
 * Its own screen rather than a second panel under Domains.
 *
 * Verifying a domain and wiring SES to report on what it sent are separate
 * jobs done at different times: one is set up once per domain, the other
 * once per account. Stacked together they read as one long page with no
 * particular subject.
 */
export default async function ReportingSettingsPage() {
  await requireCapability("domain:manage");
  const events = await eventsStatus();
  return <EventsPanel status={events} />;
}
