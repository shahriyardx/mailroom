import { InboundPanel } from "@/components/mail/inbound-panel";
import { inboundStatus } from "@/server/inbound";
import { cloudflareStatus } from "@/server/integrations";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function InboundSettingsPage() {
  const access = await requireCapability("inbound:manage");
  const [status, connection] = await Promise.all([
    inboundStatus(access.orgId),
    cloudflareStatus(access.orgId),
  ]);

  return <InboundPanel status={status} connection={connection} />;
}
