import { CustomEventsPanel } from "@/components/mail/custom-events-panel";
import { env } from "@/lib/env";
import { eventsView } from "@/server/custom-events";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const access = await requireCapability("mail:send");
  const events = await eventsView(access.orgId);

  return <CustomEventsPanel events={events} appUrl={env.appUrl} />;
}
