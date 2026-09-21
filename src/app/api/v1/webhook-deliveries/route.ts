import { db } from "@/db";
import { webhookDelivery } from "@/db/schema";
import { boolOf, limitOf, makeCursor, page, splitCursor } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { serializeDelivery } from "@/server/api-serialize";
import { and, asc, desc, eq, gt, lt, or } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/webhook-deliveries — every attempt made at every endpoint,
 * newest first, with the status and the reply that came back.
 *
 * Filters: `webhook_id`, `event`, `succeeded`.
 */
export const GET = apiRoute("webhooks:read", async ({ caller, url }) => {
  const limit = limitOf(url);
  const filters = [eq(webhookDelivery.organizationId, caller.orgId)];

  const hookId = url.searchParams.get("webhook_id");
  if (hookId) filters.push(eq(webhookDelivery.webhookId, hookId));

  const event = url.searchParams.get("event");
  if (event) filters.push(eq(webhookDelivery.event, event));

  const succeeded = boolOf(url, "succeeded");
  if (succeeded !== null) filters.push(eq(webhookDelivery.succeeded, succeeded));

  const cursor = splitCursor(url.searchParams.get("next_cursor") ?? url.searchParams.get("cursor"));
  if (cursor) {
    const [stamp, id] = cursor;
    const at = new Date(Number(stamp));
    filters.push(
      or(
        lt(webhookDelivery.createdAt, at),
        and(eq(webhookDelivery.createdAt, at), gt(webhookDelivery.id, id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(webhookDelivery)
    .where(and(...filters))
    .orderBy(desc(webhookDelivery.createdAt), asc(webhookDelivery.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return page(
    items.map(serializeDelivery),
    hasMore && last ? makeCursor(last.createdAt, last.id) : null,
  );
});
