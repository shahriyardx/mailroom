import { TemplateBuilder } from "@/components/mail/template-builder";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

/*
 * A template that does not exist yet. The same builder, given nothing, which
 * saves by creating and then takes over the row's own URL.
 */
export default async function NewTemplatePage() {
  await requireCapability("rules:manage");
  return <TemplateBuilder template={null} basePath="/settings/templates" />;
}
