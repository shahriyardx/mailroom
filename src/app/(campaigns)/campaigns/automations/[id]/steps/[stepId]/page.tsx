import { StepBuilder } from "@/components/mail/template-builder";
import { findAutomation } from "@/server/automations";
import { requireCapability } from "@/server/permissions";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/** One email out of a series, in the same builder everything else uses. */
export default async function StepPage({
  params,
}: {
  params: Promise<{ id: string; stepId: string }>;
}) {
  const access = await requireCapability("mail:send");
  const { id, stepId } = await params;

  const row = await findAutomation(access.orgId, id);
  if (!row) notFound();

  const step = row.nodes.find((entry) => entry.id === stepId && entry.kind === "email");
  if (!step) notFound();

  return (
    <StepBuilder step={step} automationName={row.name} basePath={`/campaigns/automations/${id}`} />
  );
}
