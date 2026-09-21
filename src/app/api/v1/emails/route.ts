import { db } from "@/db";
import { deliveryStatusEnum, mailbox, message } from "@/db/schema";
import { dateOf, fail, limitOf, makeCursor, ok, page, readBody, splitCursor } from "@/lib/api-http";
import { apiRoute, scopedMailboxIds, testFilter } from "@/server/api-auth";
import { emailSchema, sendOne } from "@/server/api-send";
import { serializeMessage } from "@/server/api-serialize";
import { idempotency } from "@/server/idempotency";
import { SendError } from "@/server/send";
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";

type DeliveryStatus = (typeof deliveryStatusEnum.enumValues)[number];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/emails
 *
 * The send endpoint. The request shape follows the common transactional-email
 * convention, so an existing SDK call ports over with only a base-URL change.
 *
 * Send an `Idempotency-Key` header to make a retry safe.
 */
export const POST = apiRoute("emails:send", async ({ request, caller }) => {
  const input = await readBody(request, emailSchema);

  const guard = await idempotency(request, caller.orgId, "POST /v1/emails", input);
  if (guard.replay) return guard.replay;

  try {
    const result = await sendOne(caller, input);
    await guard.remember(202, result as unknown as Record<string, unknown>);
    return ok(result, 202);
  } catch (error) {
    if (error instanceof SendError) {
      return fail(statusToCode(error.status), error.message);
    }
    throw error;
  }
});

function statusToCode(status: number) {
  if (status === 404) return "not_found" as const;
  if (status === 403) return "forbidden" as const;
  if (status === 409) return "conflict" as const;
  if (status === 502 || status >= 500) return "server_error" as const;
  return "invalid_request" as const;
}

/**
 * GET /api/v1/emails — what this account has sent, newest first.
 *
 * Filters: `status`, `from`, `to`, `subject`, `q`, `since`, `until`,
 * `mailbox_id`, `mailbox`, `domain`, `opened`, `api_key_id`.
 */
export const GET = apiRoute("emails:read", async ({ caller, url }) => {
  const mailboxIds = await scopedMailboxIds(caller, url);
  if (mailboxIds.length === 0) return page([], null);

  const limit = limitOf(url);
  const filters = [inArray(message.mailboxId, mailboxIds), eq(message.isOutbound, true)];

  // Drafts are outbound but have not been sent, so they are not "emails" in
  // the sense this endpoint means.
  filters.push(eq(message.isDraft, false));

  const test = testFilter(caller, url);
  if (test) filters.push(test);

  // Only names the enum actually has: an unknown one would otherwise reach
  // Postgres as a cast of arbitrary text.
  const status = url.searchParams.get("status");
  if (status) {
    const wanted = status
      .split(",")
      .map((value) => value.trim())
      .filter((value): value is DeliveryStatus =>
        (deliveryStatusEnum.enumValues as readonly string[]).includes(value),
      );
    if (wanted.length === 0) {
      return fail(
        "invalid_request",
        `status must be one of: ${deliveryStatusEnum.enumValues.join(", ")}`,
      );
    }
    filters.push(inArray(message.deliveryStatus, wanted));
  }

  const from = url.searchParams.get("from");
  if (from) filters.push(eq(message.fromAddress, from.toLowerCase().trim()));

  const to = url.searchParams.get("to");
  if (to) {
    // `to` is a jsonb array of {name, address}; ask Postgres rather than
    // pulling every row back to filter here.
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${message.to}) AS r
        WHERE lower(r->>'address') = ${to.toLowerCase().trim()}
      )`,
    );
  }

  const subject = url.searchParams.get("subject");
  if (subject) filters.push(ilike(message.subject, `%${subject}%`));

  const query = url.searchParams.get("q")?.trim();
  if (query) {
    filters.push(
      or(
        sql`${message.searchVector} @@ websearch_to_tsquery('english', ${query})`,
        ilike(message.subject, `%${query}%`),
      )!,
    );
  }

  const apiKeyId = url.searchParams.get("api_key_id");
  if (apiKeyId) filters.push(eq(message.apiKeyId, apiKeyId));

  const opened = url.searchParams.get("opened");
  if (opened === "true") filters.push(sql`${message.openedAt} IS NOT NULL`);
  if (opened === "false") filters.push(sql`${message.openedAt} IS NULL`);

  const since = dateOf(url, "since");
  if (since) filters.push(gte(message.createdAt, since));
  const until = dateOf(url, "until");
  if (until) filters.push(lte(message.createdAt, until));

  const cursor = splitCursor(url.searchParams.get("next_cursor") ?? url.searchParams.get("cursor"));
  if (cursor) {
    const [stamp, id] = cursor;
    const at = new Date(Number(stamp));
    filters.push(
      or(lt(message.createdAt, at), and(eq(message.createdAt, at), lt(message.id, id)))!,
    );
  }

  const rows = await db
    .select({ row: message, address: mailbox.address })
    .from(message)
    .innerJoin(mailbox, eq(mailbox.id, message.mailboxId))
    .where(and(...filters))
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return page(
    items.map((entry) => serializeMessage(entry.row, { mailboxAddress: entry.address })),
    hasMore && last ? makeCursor(last.row.createdAt, last.row.id) : null,
  );
});
