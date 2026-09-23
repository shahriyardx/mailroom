import { Panel } from "@/components/kit";
import { LogTable } from "@/components/mail/log-table";
import { type Direction, listLog, logKeys } from "@/server/logs";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function LogsPage({
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

  const direction: Direction = one("direction") === "receiving" ? "receiving" : "sending";
  const days = Number(one("days") ?? "15");

  const [log, keys] = await Promise.all([
    listLog(access, {
      direction,
      q: one("q"),
      status: direction === "sending" ? one("status") : undefined,
      days: Number.isFinite(days) ? days : 15,
      keyId: direction === "sending" ? one("key") : undefined,
      test: one("test") === "1",
      cursor: one("cursor"),
    }),
    logKeys(access.orgId),
  ]);

  return (
    <Panel
      title="Activity"
      description="Every message this account sent or received, what happened to it, and what it looked like."
    >
      <LogTable rows={log.rows} direction={direction} keys={keys} nextCursor={log.nextCursor} />
    </Panel>
  );
}
