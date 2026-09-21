import { db } from "@/db";
import { mailbox, webhook } from "@/db/schema";
import { fail, ok, page, readBody } from "@/lib/api-http";
import { newId } from "@/lib/utils";
import { apiRoute, callerMailboxIds } from "@/server/api-auth";
import { serializeWebhook } from "@/server/api-serialize";
import { WEBHOOK_EVENTS, isWebhookEvent, makeWebhookSecret } from "@/server/webhooks";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/webhooks — the endpoints events are sent to, and their health. */
export const GET = apiRoute("webhooks:read", async ({ caller }) => {
  const rows = await db
    .select()
    .from(webhook)
    .where(eq(webhook.organizationId, caller.orgId))
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

  const target = new URL(input.url);
  if (target.protocol !== "https:" && target.hostname !== "localhost") {
    return fail("invalid_request", "A webhook URL must be https");
  }

  const events = input.events ?? ["*"];
  const unknown = events.filter((event) => event !== "*" && !isWebhookEvent(event));
  if (unknown.length > 0) {
    return fail(
      "invalid_request",
      `Unknown event: ${unknown.join(", ")}. Known events: ${WEBHOOK_EVENTS.join(", ")}`,
    );
  }

  if (input.mailbox_id) {
    const reachable = await callerMailboxIds(caller);
    if (!reachable.includes(input.mailbox_id)) {
      return fail("not_found", "No such mailbox");
    }
    const owns = await db.query.mailbox.findFirst({
      where: and(eq(mailbox.id, input.mailbox_id), eq(mailbox.organizationId, caller.orgId)),
    });
    if (!owns) return fail("not_found", "No such mailbox");
  }

  const id = newId("whk");
  await db.insert(webhook).values({
    id,
    organizationId: caller.orgId,
    url: input.url,
    description: input.description ?? null,
    events,
    secret: makeWebhookSecret(),
    enabled: input.enabled ?? true,
    mailboxId: input.mailbox_id ?? null,
  });

  const [row] = await db.select().from(webhook).where(eq(webhook.id, id));
  return ok(serializeWebhook(row!, { secret: true }), 201);
});
