import { TemplatePanel } from "@/components/mail/template-panel";
import { requireCapability } from "@/server/permissions";
import { listTemplates } from "@/server/templates";

export const dynamic = "force-dynamic";

export default async function TemplatesSettingsPage() {
  const access = await requireCapability("rules:manage");
  const templates = await listTemplates(access.orgId);

  return <TemplatePanel templates={templates} />;
}
