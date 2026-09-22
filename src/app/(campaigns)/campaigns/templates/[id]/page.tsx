import { TemplateBuilder } from "@/components/mail/template-builder";
import { requireCapability } from "@/server/permissions";
import { findTemplate } from "@/server/templates";
import { notFound } from "next/navigation";

// Written out rather than re-exported: Next reads this at build time and only
// understands a literal here.
export const dynamic = "force-dynamic";

/*
 * The same builder as Settings → templates, inside the campaigns shell, so
 * that somebody writing a broadcast is not thrown into the other half of the
 * app to change a heading.
 */
export default async function CampaignTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await requireCapability("rules:manage");
  const { id } = await params;

  const row = await findTemplate(access.orgId, id);
  if (!row) notFound();

  return <TemplateBuilder template={row} basePath="/campaigns/templates" />;
}
