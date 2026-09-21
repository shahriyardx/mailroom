import { db } from "@/db";
import { webhook } from "@/db/schema";
import { fail, ok, page, readBody } from "@/lib/api-http";
import { newId } from "@/lib/utils";
import { apiRoute, mayWatchDomain, mayWatchMailbox, reachableWebhookIds } from "@/server/api-auth";
import { serializeWebhook } from "@/server/api-serialize";
import {
  WEBHOOK_EVENTS,
  checkWebhookUrl,
  isWebhookEvent,
  makeWebhookSecret,
} from "@/server/webhooks";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/webhooks — the endpoints events are sent to, and their health. */
export const GET = apiRoute("webhooks:read", async ({ caller }) => {
  const visible = await reachableWebhookIds(caller);
  if (visible !== null && visible.length === 0) return page([], null);

  const rows = await db
    .select()
    .from(webhook)
    .where(
      visible === null
        ? eq(webhook.organizationId, caller.orgId)
        : and(eq(webhook.organizationId, caller.orgId), inArray(webhook.id, visible)),
    )
    .orderBy(desc(webhook.createdAt));
  return page(
    rows.map((row) => serializeWebhook(row)),
    null,
  );
});

const createSchema = z.object({
  url: z.string().url(),
  description: z.string().max(200).optional(),
  /** Event names, or ["*"] for everything including events added later. */
  events: z.array(z.string()).min(1).optional(),
  /** Only fire for mail in this mailbox. */
  mailbox_id: z.string().optional(),
  domain_id: z.string().optional(),
  enabled: z.boolean().optional(),
});

/**
 * POST /api/v1/webhooks — start being told what happens to mail.
 *
 * The reply carries the signing secret. It is shown here and never again:
 * every call is signed with it, and an endpoint that does not check the
 * signature will accept anything anybody posts at it.
 */
export const POST = apiRoute("webhooks:write", async ({ caller, request }) => {
  const input = await readBody(request, createSchema);

  const target = checkWebhookUrl(input.url);
  if (!target.ok) return fail("invalid_request", target.reason);

  const events = input.events ?? ["*"];
  const unknown = events.filter((event) => event !== "*" && !isWebhookEvent(event));
  if (unknown.length > 0) {
    return fail(
      "invalid_request",
      `Unknown event: ${unknown.join(", ")}. Known events: ${WEBHOOK_EVENTS.join(", ")}`,
    );
  }

  // A webhook with no mailbox hears about every address. A key that reaches
  // only part of the account must not be able to make one, or it would be a
  // way to receive mail the key cannot read.
  if (input.mailbox_id && input.domain_id) {
    return fail("invalid_request", "Give a mailbox_id or a domain_id, not both");
  }

  const watching = await mayWatchMailbox(caller, input.mailbox_id);
  if (!watching.ok) {
    return fail(watching.reason === "No such mailbox" ? "not_found" : "forbidden", watching.reason);
  }

  const watchingDomain = await mayWatchDomain(caller, input.domain_id);
  if (!watchingDomain.ok) {
    return fail(
      watchingDomain.reason === "No such domain" ? "not_found" : "forbidden",
      watchingDomain.reason,
    );
  }

  const id = newId("whk");
  await db.insert(webhook).values({
    id,
    organizationId: caller.orgId,
    url: target.url.toString(),
    description: input.description ?? null,
    events,
    secret: makeWebhookSecret(),
    enabled: input.enabled ?? true,
    mailboxId: input.mailbox_id ?? null,
    domainId: input.domain_id ?? null,
  });

  const [row] = await db.select().from(webhook).where(eq(webhook.id, id));
  return ok(serializeWebhook(row!, { secret: true }), 201);
});
