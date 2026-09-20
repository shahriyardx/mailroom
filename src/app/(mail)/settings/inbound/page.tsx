import { InboundPanel } from "@/components/mail/inbound-panel";
import { requireUser } from "@/lib/session";
import { inboundStatus } from "@/server/inbound";
import { cloudflareStatus } from "@/server/integrations";

export const dynamic = "force-dynamic";

export default async function InboundSettingsPage() {
  const user = await requireUser();
  const [status, connection] = await Promise.all([
    inboundStatus(user.id),
    cloudflareStatus(user.id),
  ]);

  return <InboundPanel status={status} connection={connection} />;
}
