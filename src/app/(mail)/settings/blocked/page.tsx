import { SuppressionPanel } from "@/components/mail/suppression-panel";
import { db } from "@/db";
import { suppression } from "@/db/schema";
import { requireCapability } from "@/server/permissions";
import { and, count, desc, eq, ilike, not } from "drizzle-orm";

export const dynamic = "force-dynamic";

const PER_PAGE = 50;

/** `%` and `_` are wildcards to Postgres; a reader typing them means them literally. */
function literal(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Why an address is blocked, worked out from the words SES used.
 *
 * The column is free text and always has been: SES sends a sentence, the API
 * lets a caller write their own, and neither is going to start agreeing on an
 * enum. Reading the two words that matter out of it is what the screen needs,
 * and it costs nothing that a migration would not cost more of.
 */
const KINDS = ["all", "bounce", "complaint", "manual"] as const;
type Kind = (typeof KINDS)[number];

function reasonIs(kind: Exclude<Kind, "all">) {
  const bounced = ilike(suppression.reason, "%bounce%");
  const reported = ilike(suppression.reason, "%complaint%");

  if (kind === "bounce") return bounced;
  if (kind === "complaint") return reported;
  // Anything nobody's mail server said: blocked through the API, or by hand.
  return and(not(bounced), not(reported));
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
  const kind = KINDS.includes(one("reason") as Kind) ? (one("reason") as Kind) : "all";

  const mine = eq(suppression.organizationId, access.orgId);
  const searched = query ? and(mine, ilike(suppression.address, `%${literal(query)}%`)) : mine;
  const where = kind === "all" ? searched : and(searched, reasonIs(kind));

  /**
   * The count is asked for separately rather than inferred from the rows.
   *
   * This list decides whether mail is refused, so "is this address blocked?"
   * has to have a real answer. A page that shows the first fifty rows and says
   * nothing about the rest answers that question wrongly, and quietly.
   */
  const [[matching], [total], rows, [bounces], [complaints]] = await Promise.all([
    db.select({ value: count() }).from(suppression).where(where),
    db.select({ value: count() }).from(suppression).where(mine),
    db
      .select()
      .from(suppression)
      .where(where)
      .orderBy(desc(suppression.createdAt))
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE),
    // The counts are of the whole list rather than of the search, so the
    // filters read as what is on the blocklist rather than as what is left
    // after two other controls have had their say.
    db
      .select({ value: count() })
      .from(suppression)
      .where(and(mine, reasonIs("bounce"))),
    db
      .select({ value: count() })
      .from(suppression)
      .where(and(mine, reasonIs("complaint"))),
  ]);

  const found = matching?.value ?? 0;
  const everything = total?.value ?? found;

  return (
    <SuppressionPanel
      rows={rows}
      query={query}
      kind={kind}
      matching={found}
      total={everything}
      counts={{
        all: everything,
        bounce: bounces?.value ?? 0,
        complaint: complaints?.value ?? 0,
        manual: Math.max(0, everything - (bounces?.value ?? 0) - (complaints?.value ?? 0)),
      }}
      page={page}
      pageCount={Math.max(1, Math.ceil(found / PER_PAGE))}
    />
  );
}
