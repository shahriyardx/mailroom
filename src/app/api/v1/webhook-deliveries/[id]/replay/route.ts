import { db } from "@/db";
import { webhookDelivery } from "@/db/schema";
import { fail, ok } from "@/lib/api-http";
import { apiRoute, reachableWebhookIds } from "@/server/api-auth";
import { replayDelivery } from "@/server/webhooks";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhook-deliveries/:id/replay
 *
 * Sends a stored payload again. What an endpoint that was down gets caught up
 * with, once it is back.
 */
export const POST = apiRoute<{ id: string }>("webhooks:write", async ({ caller, params }) => {
  const visible = await reachableWebhookIds(caller);
  if (visible !== null) {
    const [row] = await db
      .select({ webhookId: webhookDelivery.webhookId })
      .from(webhookDelivery)
      .where(
        and(eq(webhookDelivery.id, params.id), eq(webhookDelivery.organizationId, caller.orgId)),
      )
      .limit(1);
    if (!row || !visible.includes(row.webhookId)) {
      return fail("not_found", "No such delivery");
    }
  }

  const result = await replayDelivery(caller.orgId, params.id);
  if (!result) return fail("not_found", "No such delivery");

  return ok(
    {
      object: "webhook_replay",
      delivery_id: params.id,
      succeeded: result.succeeded,
      status_code: result.statusCode,
      duration_ms: result.durationMs,
      response_body: result.responseBody,
      error: result.error,
    },
    result.succeeded ? 200 : 502,
  );
});
