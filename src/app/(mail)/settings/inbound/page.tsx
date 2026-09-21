import { InboundPanel } from "@/components/mail/inbound-panel";
import { requireAccess } from "@/server/access";
import { inboundStatus } from "@/server/inbound";
import { cloudflareStatus } from "@/server/integrations";

export const dynamic = "force-dynamic";

export default async function InboundSettingsPage() {
  const access = await requireAccess();
  const [status, connection] = await Promise.all([
    inboundStatus(access.orgId),
    cloudflareStatus(access.orgId),
  ]);

  return <InboundPanel status={status} connection={connection} />;
}
