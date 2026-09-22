import { TemplateBuilder } from "@/components/mail/template-builder";
import { requireCapability } from "@/server/permissions";
import { findTemplate } from "@/server/templates";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/*
 * One template, on a page of its own.
 *
 * A builder needs the whole window: a palette, a canvas and an inspector do
 * not fit in a dialog, and a dialog cannot be linked to, reloaded or left
 * open in a second tab next to the code that sends it.
 */
export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireCapability("rules:manage");
  const { id } = await params;

  const row = await findTemplate(access.orgId, id);
  if (!row) notFound();

  return <TemplateBuilder template={row} basePath="/settings/templates" />;
}
