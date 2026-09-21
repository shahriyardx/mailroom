import { SuppressionPanel } from "@/components/mail/suppression-panel";
import { db } from "@/db";
import { suppression } from "@/db/schema";
import { requireCapability } from "@/server/permissions";
import { and, count, desc, eq, ilike } from "drizzle-orm";

export const dynamic = "force-dynamic";

const PER_PAGE = 50;

/** `%` and `_` are wildcards to Postgres; a reader typing them means them literally. */
function literal(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export default async function BlockedSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await requireCapability("rules:manage");
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const query = (one("q") ?? "").trim();
  const page = Math.max(1, Number(one("page")) || 1);

  const mine = eq(suppression.organizationId, access.orgId);
  const where = query ? and(mine, ilike(suppression.address, `%${literal(query)}%`)) : mine;

  /**
   * The count is asked for separately rather than inferred from the rows.
   *
   * This list decides whether mail is refused, so "is this address blocked?"
   * has to have a real answer. A page that shows the first fifty rows and says
   * nothing about the rest answers that question wrongly, and quietly.
   */
  const [[matching], [total], rows] = await Promise.all([
    db.select({ value: count() }).from(suppression).where(where),
    query
      ? db.select({ value: count() }).from(suppression).where(mine)
      : Promise.resolve([{ value: -1 }]),
    db
      .select()
      .from(suppression)
      .where(where)
      .orderBy(desc(suppression.createdAt))
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE),
  ]);

  const found = matching?.value ?? 0;

  return (
    <SuppressionPanel
      rows={rows}
      query={query}
      matching={found}
      total={total?.value === -1 ? found : (total?.value ?? found)}
      page={page}
      pageCount={Math.max(1, Math.ceil(found / PER_PAGE))}
    />
  );
}
