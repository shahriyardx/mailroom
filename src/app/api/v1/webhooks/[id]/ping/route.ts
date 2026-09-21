import { fail, ok } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { pingWebhook } from "@/server/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhooks/:id/ping — send a test event and wait for the answer.
 *
 * Unlike a real event this is not retried and not sent in the background: the
 * point is to see, now, whether the endpoint is reachable and whether it is
 * checking the signature correctly.
 */
export const POST = apiRoute<{ id: string }>("webhooks:write", async ({ caller, params }) => {
  const result = await pingWebhook(caller.orgId, params.id);
  if (!result) return fail("not_found", "No such webhook");

  return ok(
    {
      object: "webhook_ping",
      webhook_id: params.id,
      succeeded: result.succeeded,
      status_code: result.statusCode,
      duration_ms: result.durationMs,
      response_body: result.responseBody,
      error: result.error,
    },
    result.succeeded ? 200 : 502,
  );
});
