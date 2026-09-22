import { TemplateBuilder } from "@/components/mail/template-builder";
import { requireCapability } from "@/server/permissions";

// Written out rather than re-exported: Next reads this at build time and only
// understands a literal here.
export const dynamic = "force-dynamic";

export default async function NewCampaignTemplatePage() {
  await requireCapability("rules:manage");
  return <TemplateBuilder template={null} basePath="/campaigns/templates" />;
}
