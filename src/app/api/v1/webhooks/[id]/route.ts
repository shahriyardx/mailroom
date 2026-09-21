import { db } from "@/db";
import { webhook } from "@/db/schema";
import { boolOf, fail, ok, readBody } from "@/lib/api-http";
import { apiRoute, callerMailboxIds } from "@/server/api-auth";
import { serializeWebhook } from "@/server/api-serialize";
import { WEBHOOK_EVENTS, isWebhookEvent, makeWebhookSecret } from "@/server/webhooks";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findHook(orgId: string, id: string) {
  const row = await db.query.webhook.findFirst({
    where: and(eq(webhook.id, id), eq(webhook.organizationId, orgId)),
  });
  return row ?? null;
}

/** GET /api/v1/webhooks/:id */
export const GET = apiRoute<{ id: string }>("webhooks:read", async ({ caller, params }) => {
  const row = await findHook(caller.orgId, params.id);
  if (!row) return fail("not_found", "No such webhook");
  return ok(serializeWebhook(row));
});

const patchSchema = z
  .object({
    url: z.string().url().optional(),
    description: z.string().max(200).nullable().optional(),
    events: z.array(z.string()).min(1).optional(),
    enabled: z.boolean().optional(),
    mailbox_id: z.string().nullable().optional(),
    /** Replaces the signing secret and returns the new one, once. */
    rotate_secret: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change" });

/**
 * PATCH /api/v1/webhooks/:id
 *
 * Turning an endpoint back on also clears its failure count, since that is
 * what somebody means by fixing it.
 */
export const PATCH = apiRoute<{ id: string }>(
  "webhooks:write",
  async ({ caller, params, request }) => {
    const input = await readBody(request, patchSchema);
    const row = await findHook(caller.orgId, params.id);
    if (!row) return fail("not_found", "No such webhook");

    if (input.url) {
      const target = new URL(input.url);
      if (target.protocol !== "https:" && target.hostname !== "localhost") {
        return fail("invalid_request", "A webhook URL must be https");
      }
    }

    if (input.events) {
      const unknown = input.events.filter((event) => event !== "*" && !isWebhookEvent(event));
      if (unknown.length > 0) {
        return fail(
          "invalid_request",
          `Unknown event: ${unknown.join(", ")}. Known events: ${WEBHOOK_EVENTS.join(", ")}`,
        );
      }
    }

    if (input.mailbox_id) {
      const reachable = await callerMailboxIds(caller);
      if (!reachable.includes(input.mailbox_id)) return fail("not_found", "No such mailbox");
    }

    const secret = input.rotate_secret ? makeWebhookSecret() : row.secret;

    await db
      .update(webhook)
      .set({
        url: input.url ?? row.url,
        description: input.description === undefined ? row.description : input.description,
        events: input.events ?? row.events,
        enabled: input.enabled ?? row.enabled,
        mailboxId: input.mailbox_id === undefined ? row.mailboxId : input.mailbox_id,
        secret,
        ...(input.enabled === true ? { consecutiveFailures: 0, lastError: null } : {}),
      })
      .where(eq(webhook.id, row.id));

    const [updated] = await db.select().from(webhook).where(eq(webhook.id, row.id));
    return ok(serializeWebhook(updated!, { secret: Boolean(input.rotate_secret) }));
  },
);

/** DELETE /api/v1/webhooks/:id — the endpoint and its delivery history go together. */
export const DELETE = apiRoute<{ id: string }>(
  "webhooks:write",
  async ({ caller, params, url }) => {
    const row = await findHook(caller.orgId, params.id);
    if (!row) return fail("not_found", "No such webhook");

    // Turning it off keeps the history, which is usually what somebody wants
    // while an endpoint is being repaired.
    if (boolOf(url, "disable_only")) {
      await db.update(webhook).set({ enabled: false }).where(eq(webhook.id, row.id));
      const [updated] = await db.select().from(webhook).where(eq(webhook.id, row.id));
      return ok(serializeWebhook(updated!));
    }

    await db.delete(webhook).where(eq(webhook.id, row.id));
    return ok({ object: "webhook", id: row.id, deleted: true });
  },
);
