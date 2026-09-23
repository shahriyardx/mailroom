import "server-only";
import { db } from "@/db";
import { type SegmentRule, listMember, mailingList, segment } from "@/db/schema";
import { newId } from "@/lib/utils";
import { type SQL, and, asc, eq, or, sql } from "drizzle-orm";

/**
 * Parts of a list, described rather than listed.
 *
 * A segment stores the question, not the answer. Every audience is worked out
 * at the moment of sending, because a stored membership is a thing that goes
 * quietly stale — somebody who unsubscribed on Tuesday is still in Monday's
 * copy of it, and they get mailed.
 *
 * The rule language is small on purpose. Everything below compiles to one
 * WHERE clause over the member table, so asking "how big is this segment" is
 * a single count, not fifty thousand round trips.
 */

/** Every field a rule can ask about, and what to call it in a form. */
export const RULE_FIELDS = [
  { key: "address", label: "Email address", kind: "text" },
  { key: "name", label: "Name", kind: "text" },
  { key: "status", label: "Status", kind: "status" },
  { key: "consentAt", label: "Joined", kind: "date" },
  { key: "engagement", label: "Engagement", kind: "engagement" },
] as const;

export const RULE_OPS: Record<string, { key: SegmentRule["op"]; label: string }[]> = {
  text: [
    { key: "is", label: "is" },
    { key: "is_not", label: "is not" },
    { key: "contains", label: "contains" },
    { key: "not_contains", label: "does not contain" },
    { key: "set", label: "is set" },
    { key: "not_set", label: "is empty" },
  ],
  status: [
    { key: "is", label: "is" },
    { key: "is_not", label: "is not" },
  ],
  date: [
    { key: "before", label: "before" },
    { key: "after", label: "after" },
  ],
  engagement: [
    { key: "opened", label: "opened a campaign" },
    { key: "not_opened", label: "opened nothing" },
    { key: "clicked", label: "clicked a campaign" },
    { key: "not_clicked", label: "clicked nothing" },
  ],
};

/**
 * What a field name points at.
 *
 * Anything that is not a known column is read out of the member's merge
 * fields, so an import that brought a "plan" or a "city" column can be
 * segmented on without a schema change. `->>` rather than `->` because every
 * comparison here is against text.
 */
function column(field: string): SQL {
  if (field === "address") return sql`${listMember.address}`;
  if (field === "name") return sql`${listMember.name}`;
  if (field === "status") return sql`${listMember.status}::text`;
  if (field === "consentAt") return sql`${listMember.consentAt}`;
  const key = field.startsWith("fields.") ? field.slice("fields.".length) : field;
  return sql`(${listMember.fields} ->> ${key})`;
}

/**
 * "In the last N days", or ever.
 *
 * An empty or unparseable value means no window at all, which is the right
 * default: a rule somebody half-filled in should widen the question rather
 * than silently match nobody.
 */
function within(value: string, timestamp: SQL): SQL {
  const days = Number.parseInt(value, 10);
  if (!Number.isFinite(days) || days <= 0) return sql`true`;
  return sql`${timestamp} > now() - ${`${days} days`}::interval`;
}

/** Whether this person has ever done something with a campaign we sent them. */
function engagement(rule: SegmentRule): SQL {
  const opened = rule.op === "opened" || rule.op === "not_opened";
  const stamp = opened ? sql`broadcast_recipient.opened_at` : sql`broadcast_recipient.clicked_at`;

  const exists = sql`exists (
    select 1 from broadcast_recipient
    where broadcast_recipient.list_member_id = ${listMember.id}
      and ${stamp} is not null
      and ${within(rule.value, stamp)}
  )`;

  const negative = rule.op === "not_opened" || rule.op === "not_clicked";
  return negative ? sql`not ${exists}` : exists;
}

/** One rule, as a WHERE fragment. Null when it asks nothing answerable. */
export function ruleCondition(rule: SegmentRule): SQL | null {
  if (rule.op === "opened" || rule.op === "not_opened") return engagement(rule);
  if (rule.op === "clicked" || rule.op === "not_clicked") return engagement(rule);

  const field = column(rule.field);
  const value = rule.value.trim();

  switch (rule.op) {
    case "set":
      return sql`${field} is not null and ${field} <> ''`;
    case "not_set":
      return sql`${field} is null or ${field} = ''`;
    case "before":
      return value ? sql`${field} < ${value}::timestamptz` : null;
    case "after":
      return value ? sql`${field} > ${value}::timestamptz` : null;
    case "is":
      return value ? sql`lower(${field}) = lower(${value})` : null;
    case "is_not":
      // A null field is "not x" — otherwise "plan is not free" quietly drops
      // everybody who has no plan recorded, which is never what was meant.
      return value ? sql`(${field} is null or lower(${field}) <> lower(${value}))` : null;
    case "contains":
      return value ? sql`${field} ilike ${`%${value}%`}` : null;
    case "not_contains":
      return value ? sql`(${field} is null or ${field} not ilike ${`%${value}%`})` : null;
    default:
      return null;
  }
}

/**
 * The whole segment, as one condition.
 *
 * A segment with no usable rules returns null, which every caller reads as
 * "the entire list". That is deliberate: a half-written segment must not send
 * to nobody without saying why, and a send to nobody is refused elsewhere
 * with an error a person can act on.
 */
export function segmentCondition(row: { matchAll: boolean; rules: SegmentRule[] }):
  | SQL
  | undefined {
  const parts = row.rules.map(ruleCondition).filter((part): part is SQL => part !== null);
  if (parts.length === 0) return undefined;
  return row.matchAll ? and(...parts) : or(...parts);
}

/* -------------------------------------------------------------------------- */
/* Storing them                                                               */
/* -------------------------------------------------------------------------- */

/** Rules as they arrive from a form or the API, with the nonsense dropped. */
export function readRules(raw: unknown): SegmentRule[] {
  if (!Array.isArray(raw)) return [];
  const ops = new Set(Object.values(RULE_OPS).flatMap((list) => list.map((entry) => entry.key)));

  return raw
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    )
    .map((entry) => ({
      field: typeof entry.field === "string" ? entry.field.slice(0, 80) : "",
      op: entry.op as SegmentRule["op"],
      value: typeof entry.value === "string" ? entry.value.slice(0, 200) : "",
    }))
    .filter((rule) => rule.field !== "" && ops.has(rule.op))
    .slice(0, 20);
}

export async function createSegment(
  orgId: string,
  input: { listId: string; name: string; matchAll?: boolean; rules?: unknown },
) {
  const name = input.name.trim();
  if (!name) throw new Error("Give the segment a name");

  const list = await db.query.mailingList.findFirst({
    where: and(eq(mailingList.id, input.listId), eq(mailingList.organizationId, orgId)),
    columns: { id: true },
  });
  if (!list) throw new Error("No such list");

  const id = newId("sgm");
  await db.insert(segment).values({
    id,
    organizationId: orgId,
    listId: input.listId,
    name,
    matchAll: input.matchAll ?? true,
    rules: readRules(input.rules),
  });
  return id;
}

export async function updateSegment(
  orgId: string,
  id: string,
  input: { name?: string; matchAll?: boolean; rules?: unknown },
) {
  const row = await findSegment(orgId, id);
  if (!row) throw new Error("No such segment");

  await db
    .update(segment)
    .set({
      name: input.name?.trim() || row.name,
      matchAll: input.matchAll ?? row.matchAll,
      rules: input.rules === undefined ? row.rules : readRules(input.rules),
    })
    .where(eq(segment.id, row.id));
}

export async function removeSegment(orgId: string, id: string) {
  await db.delete(segment).where(and(eq(segment.id, id), eq(segment.organizationId, orgId)));
}

export async function findSegment(orgId: string, id: string) {
  const row = await db.query.segment.findFirst({
    where: and(eq(segment.id, id), eq(segment.organizationId, orgId)),
  });
  return row ?? null;
}

export interface SegmentRow {
  id: string;
  listId: string;
  listName: string;
  name: string;
  matchAll: boolean;
  rules: SegmentRule[];
  /** How many people match it right now. */
  size: number;
}

/**
 * Every segment, with its current size.
 *
 * One count per segment rather than one query that answers all of them: the
 * conditions differ per row, so there is nothing to share, and a list of
 * segments is a handful of rows rather than a page of them.
 */
export async function segmentsView(orgId: string, listId?: string): Promise<SegmentRow[]> {
  const rows = await db
    .select({
      id: segment.id,
      listId: segment.listId,
      listName: mailingList.name,
      name: segment.name,
      matchAll: segment.matchAll,
      rules: segment.rules,
    })
    .from(segment)
    .innerJoin(mailingList, eq(mailingList.id, segment.listId))
    .where(
      listId
        ? and(eq(segment.organizationId, orgId), eq(segment.listId, listId))
        : eq(segment.organizationId, orgId),
    )
    .orderBy(asc(segment.name));

  return Promise.all(rows.map(async (row) => ({ ...row, size: await segmentSize(orgId, row) })));
}

/** How many subscribed people a segment currently matches. */
export async function segmentSize(
  orgId: string,
  row: { listId: string; matchAll: boolean; rules: SegmentRule[] },
) {
  const [answer] = await db
    .select({ howMany: sql<number>`count(*)`.mapWith(Number) })
    .from(listMember)
    .where(
      and(
        eq(listMember.organizationId, orgId),
        eq(listMember.listId, row.listId),
        eq(listMember.status, "subscribed"),
        segmentCondition(row),
      ),
    );
  return answer?.howMany ?? 0;
}
