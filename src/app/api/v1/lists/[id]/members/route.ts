import { fail, ok, readBody } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { membersView, subscribe, unsubscribeAddress } from "@/server/campaigns";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How somebody gets onto a list from outside this app.
 *
 * The one call a signup form on your own site makes. It answers what happened
 * to this person rather than a count, because that is what the form has to
 * show them — already on the list, newly added, or refused.
 */

/** GET /api/v1/lists/:id/members — who is on it. */
export const GET = apiRoute<{ id: string }>("lists:read", async ({ caller, params }) => {
  const { id } = await params;
  const rows = await membersView(caller.orgId, id, 1000);

  return ok({
    data: rows.map((row) => ({
      id: row.id,
      address: row.address,
      name: row.name,
      status: row.status,
      consent_source: row.consentSource,
      consent_at: row.consentAt,
    })),
  });
});

const Subscriber = z.object({
  address: z.string().email(),
  name: z.string().max(200).optional(),
  /** Anything else you want to merge into a subject or body later. */
  fields: z.record(z.string(), z.string()).optional(),
  /**
   * Where this person came from. Required, and deliberately so: the day
   * somebody asks why you are emailing them, "we do not record that" is both
   * a bad answer and the wrong one.
   */
  consent_source: z.string().min(1).max(200),
});

/** POST /api/v1/lists/:id/members — put somebody on it. */
export const POST = apiRoute<{ id: string }>("lists:write", async ({ caller, params, request }) => {
  const { id } = await params;
  const body = await readBody(request, Subscriber);

  try {
    const result = await subscribe(
      caller.orgId,
      id,
      { address: body.address, name: body.name, fields: body.fields },
      body.consent_source,
    );

    /*
     * A hard bounce or a complaint is not undone by a form submission. The
     * address is broken or its owner reported us, and writing there again
     * costs the sending reputation of everybody else on the list.
     */
    if (result.status === "blocked") {
      return fail(
        "conflict",
        "That address bounced or reported a previous message and cannot be resubscribed here",
      );
    }

    return ok({ id: result.id, status: result.status }, result.status === "already" ? 200 : 201);
  } catch (error) {
    return fail("invalid_request", error instanceof Error ? error.message : "Bad request");
  }
});

const Leaving = z.object({ address: z.string().email() });

/** DELETE /api/v1/lists/:id/members — take somebody off it. */
export const DELETE = apiRoute<{ id: string }>(
  "lists:write",
  async ({ caller, params, request }) => {
    const { id } = await params;
    const body = await readBody(request, Leaving);

    const result = await unsubscribeAddress(caller.orgId, id, body.address);
    if (!result) return fail("not_found", "That address is not on this list");

    return ok({ id: result.id, status: "unsubscribed" });
  },
);
