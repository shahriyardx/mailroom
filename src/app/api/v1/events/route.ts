import { fail, ok, readBody } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { emitEvent, eventsView } from "@/server/custom-events";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Events your own code posts.
 *
 * The one call that starts an automation from outside this app: something
 * happened to somebody, here is who and here is what. What runs as a result
 * is decided here rather than by the caller — your checkout does not need to
 * know which welcome series is switched on this week.
 *
 * The reply says what happened to that person in every flow listening, what
 * it stopped, and why nothing started where nothing did. An event that quietly does nothing is the
 * hardest kind of thing to debug from the other end of an HTTP call.
 */

/** GET /api/v1/events — the event names this account knows about. */
export const GET = apiRoute("events:read", async ({ caller }) => {
  const rows = await eventsView(caller.orgId);

  return ok({
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      declared: row.declared,
      seen_count: row.seenCount,
      last_seen_at: row.lastSeenAt,
      automations: row.usedBy,
      live_automations: row.liveUsedBy,
    })),
  });
});

const Event = z.object({
  /** Lowercased and tidied on the way in, so casing is never the bug. */
  event: z.string().min(1).max(60),
  email: z.string().email(),
  name: z.string().max(200).optional(),
  /** Merged onto the person, so a subject or a condition can read them. */
  fields: z.record(z.string(), z.string()).optional(),
  /**
   * Where consent came from, for somebody not on the list yet.
   *
   * Without it an unknown address is reported as skipped rather than added.
   * An event carrying an email is not the same as that person asking for
   * mail, and this is not the layer that gets to decide it was.
   */
  consent_source: z.string().min(1).max(200).optional(),
});

/** POST /api/v1/events — something happened to somebody. */
export const POST = apiRoute("events:write", async ({ caller, request }) => {
  const body = await readBody(request, Event);

  try {
    const receipt = await emitEvent(caller.orgId, {
      name: body.event,
      address: body.email,
      personName: body.name,
      fields: body.fields,
      consentSource: body.consent_source,
    });

    return ok({
      event: receipt.event,
      declared: receipt.declared,
      matched: receipt.matched.length,
      automations: receipt.matched.map((entry) => ({
        id: entry.automationId,
        name: entry.automation,
        status: entry.status,
        ...(entry.reason ? { reason: entry.reason } : {}),
      })),
      /* Flows this event ended, because it was the thing they were for. */
      stopped: receipt.stopped.map((entry) => ({
        id: entry.automationId,
        name: entry.automation,
      })),
    });
  } catch (error) {
    return fail("invalid_request", error instanceof Error ? error.message : "Bad request");
  }
});
