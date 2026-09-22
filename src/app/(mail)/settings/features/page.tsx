import { FeaturesPanel } from "@/components/mail/features-panel";
import { requireCapability } from "@/server/permissions";
import { workspaceSettings } from "@/server/workspace";

export const dynamic = "force-dynamic";

export default async function FeaturesSettingsPage() {
  const access = await requireCapability("instance:manage");
  const settings = await workspaceSettings(access.orgId);
  return <FeaturesPanel settings={settings} />;
}
