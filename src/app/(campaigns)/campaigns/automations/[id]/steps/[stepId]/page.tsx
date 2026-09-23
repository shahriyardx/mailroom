import { StepBuilder } from "@/components/mail/template-builder";
import { findAutomation } from "@/server/automations";
import { fieldNamesByList } from "@/server/campaigns";
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

  /*
   * An automation started by an event has no list of its own, so there is
   * nothing to read field names off. The two that are always there are still
   * offered; the rest appear once the flow is pointed at a list.
   */
  const fields = row.listId ? ((await fieldNamesByList(access.orgId))[row.listId] ?? []) : [];

  return (
    <StepBuilder
      step={step}
      automationName={row.name}
      mergeFields={fields}
      basePath={`/campaigns/automations/${id}`}
    />
  );
}
