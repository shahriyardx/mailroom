import { fail, ok } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { serializeMessage } from "@/server/api-serialize";
import { cancelSend } from "@/server/scheduling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/emails/:id/cancel
 *
 * Calls off a message that has not gone out — one waiting for its scheduled
 * time, or one waiting for SES to be able to take it.
 *
 * Answers 409 once a worker has picked the message up, because at that point
 * it is on its way and there is nothing left to stop.
 */
export const POST = apiRoute<{ id: string }>("emails:send", async ({ caller, params }) => {
  const result = await cancelSend(caller, params.id);
  if (!result.ok) {
    return fail(result.status === 404 ? "not_found" : "conflict", result.reason);
  }
  return ok(serializeMessage(result.message, { mailboxAddress: result.mailboxAddress }));
});
