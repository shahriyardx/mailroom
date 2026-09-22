import { ForwardingPanel } from "@/components/mail/forwarding-panel";
import { forwardingView, refreshForwardingAddresses } from "@/server/forwarding";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function ForwardingSettingsPage() {
  const access = await requireCapability("inbound:manage");

  // Nobody tells us when somebody clicks the link in their verification mail,
  // so the page asks Cloudflare on the way in. A failure is not worth a blank
  // page: the rules still render, with whatever state was last known.
  await refreshForwardingAddresses(access.orgId).catch(() => {});

  const view = await forwardingView(access.orgId);
  return <ForwardingPanel view={view} />;
}
