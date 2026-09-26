import { AutomationPeople } from "@/components/mail/automation-people";
import { summarise } from "@/lib/automation-flow";
import { automationPeople, findAutomation } from "@/server/automations";
import { requireCapability } from "@/server/permissions";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const STATUSES = ["active", "done", "stopped"] as const;

/** Who is in one automation, where each of them is, and why anybody stopped. */
export default async function AutomationPeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; node?: string; q?: string; page?: string }>;
}) {
  const access = await requireCapability("mail:send");
  const { id } = await params;
  const query = await searchParams;

  const row = await findAutomation(access.orgId, id);
  if (!row) notFound();

  const status = STATUSES.find((entry) => entry === query.status);
  const nodeId = row.nodes.some((node) => node.id === query.node) ? query.node : undefined;
  const page = Math.max(0, Number(query.page) || 0);

  const found = await automationPeople(access.orgId, id, {
    status,
    nodeId,
    search: query.q,
    page,
  });

  // Each box by what its card says, so a row reads "Waiting on 3 days"
  // rather than an id.
  const boxes = Object.fromEntries(
    row.nodes.map((node) => [node.id, { kind: node.kind, title: summarise(node).title }]),
  );

  return (
    <AutomationPeople
      automationId={id}
      name={row.name}
      people={found.people}
      total={found.total}
      counts={found.counts}
      boxes={boxes}
      filter={{ status: status ?? null, nodeId: nodeId ?? null, q: query.q ?? "", page }}
    />
  );
}
