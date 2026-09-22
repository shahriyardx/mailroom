import { MetricsPanel } from "@/components/mail/metrics-panel";
import { metricsView } from "@/server/metrics";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

/**
 * Its own screen rather than a block on the overview.
 *
 * The overview answers "is anything wrong right now". This answers "what has
 * this account been doing", which is a different question asked at a
 * different time and wants the whole width of the page to answer.
 */
export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await requireCapability("mail:read");
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const view = await metricsView(access, {
    range: one("range"),
    domainId: one("domain") ?? null,
  });

  return <MetricsPanel view={view} />;
}
