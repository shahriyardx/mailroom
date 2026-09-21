import { fail, ok, readBody } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { emailSchema, sendOne } from "@/server/api-send";
import { idempotency } from "@/server/idempotency";
import { SendError } from "@/server/send";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SES itself is the limit here; this is a size a single request can finish. */
const MAX_BATCH = 100;

const batchSchema = z.union([
  z.array(emailSchema).min(1).max(MAX_BATCH),
  z.object({ emails: z.array(emailSchema).min(1).max(MAX_BATCH) }),
]);

/**
 * POST /api/v1/emails/batch — up to 100 messages in one call.
 *
 * Every message is attempted, and the reply says what happened to each in the
 * order they were given. One bad address does not throw the rest away, which
 * is the whole reason to send a batch rather than a loop.
 *
 * The status is 202 when all of them were accepted and 207 when some were
 * not, so a client can branch without counting.
 */
export const POST = apiRoute("emails:send", async ({ request, caller }) => {
  const body = await readBody(request, batchSchema);
  const inputs = Array.isArray(body) ? body : body.emails;

  const guard = await idempotency(request, caller.orgId, "POST /v1/emails/batch", inputs);
  if (guard.replay) return guard.replay;

  const results: Record<string, unknown>[] = [];
  let failures = 0;

  // In order and one at a time. SES meters sends per second, and firing a
  // hundred at once is the fastest way to be throttled for all of them.
  for (const [index, input] of inputs.entries()) {
    try {
      const sent = await sendOne(caller, input);
      results.push({ index, ok: true, ...sent });
    } catch (error) {
      failures += 1;
      results.push({
        index,
        ok: false,
        error: error instanceof Error ? error.message : "Could not send the message",
        status: error instanceof SendError ? error.status : 500,
      });
    }
  }

  const status = failures === 0 ? 202 : 207;
  const payload = {
    object: "batch",
    sent: inputs.length - failures,
    failed: failures,
    data: results,
  };
  await guard.remember(status, payload);
  return ok(payload, status);
});

/** A GET here is a common mistake worth answering clearly. */
export const GET = apiRoute("emails:send", async () =>
  fail("invalid_request", "Batch sending is a POST. Use GET /api/v1/emails to list sent mail."),
);
