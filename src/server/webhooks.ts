import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { webhook, webhookDelivery } from "@/db/schema";
import { newId } from "@/lib/utils";
import type { WebhookEvent } from "@/lib/webhook-events";
import { and, eq, sql } from "drizzle-orm";

// The event names live in lib so the settings screen can list them without
// pulling this module, and the database, into the browser bundle.
export { WEBHOOK_EVENTS, isWebhookEvent, type WebhookEvent } from "@/lib/webhook-events";

export function makeWebhookSecret() {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/* -------------------------------------------------------------------------- */
/* Signing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The signature header sent with every call:
 *
 *   X-Mailroom-Signature: t=1700000000,v1=<hex>
 *
 * The signed string is "<t>.<body>", not the body alone, so a captured call
 * cannot be replayed later against an endpoint that checks the age of `t`.
 */
export function signPayload(
  secret: string,
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { header: `t=${timestamp},v1=${digest}`, timestamp, digest };
}

/**
 * Verifies a signature the way a receiver should, offered here so this app's
 * own tests and anyone reading the source have one correct implementation.
 */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300,
) {
  const parts = Object.fromEntries(
    header.split(",").map((piece) => {
      const at = piece.indexOf("=");
      return [piece.slice(0, at).trim(), piece.slice(at + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(parts.v1 ?? "", "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/* -------------------------------------------------------------------------- */
/* Delivery                                                                   */
/* -------------------------------------------------------------------------- */

/** Waits between attempts. Four tries spread over about forty seconds. */
const BACKOFF_MS = [0, 2_000, 10_000, 30_000];

const TIMEOUT_MS = 10_000;
/** Enough of a reply to see what an endpoint objected to, not its whole page. */
const RESPONSE_SNIPPET = 2_000;

/**
 * Turns an endpoint off after this many failures in a row. An endpoint that
 * has been gone for a day should not still be collecting retries, and the
 * owner can switch it back on once it is fixed.
 */
const DISABLE_AFTER = 20;

interface Hook {
  id: string;
  organizationId: string;
  url: string;
  secret: string;
}

/**
 * Sends one event to the endpoints that asked for it.
 *
 * Returns as soon as the rows are read: the calls themselves run behind the
 * response, because a slow endpoint must never hold up receiving a message or
 * answering a send. Each attempt is written down, so nothing is lost by not
 * waiting for it.
 */
export async function dispatchWebhooks(
  orgId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
  options: { mailboxId?: string | null } = {},
) {
  let hooks: (Hook & { events: string[]; mailboxId: string | null })[];
  try {
    hooks = await db
      .select({
        id: webhook.id,
        organizationId: webhook.organizationId,
        url: webhook.url,
        secret: webhook.secret,
        events: webhook.events,
        mailboxId: webhook.mailboxId,
      })
      .from(webhook)
      .where(and(eq(webhook.organizationId, orgId), eq(webhook.enabled, true)));
  } catch (error) {
    console.error("webhook lookup failed", error);
    return;
  }

  const wanted = hooks.filter((hook) => {
    if (!hook.events.includes("*") && !hook.events.includes(event)) return false;
    // A webhook pinned to one mailbox hears only about that mailbox. Events
    // with no mailbox of their own reach every endpoint.
    if (hook.mailboxId && options.mailboxId && hook.mailboxId !== options.mailboxId) return false;
    if (hook.mailboxId && !options.mailboxId) return false;
    return true;
  });

  for (const hook of wanted) {
    void deliverWithRetries(hook, event, data);
  }
}

function envelope(event: WebhookEvent, data: Record<string, unknown>, deliveryId: string) {
  return {
    id: deliveryId,
    object: "event",
    type: event,
    created_at: new Date().toISOString(),
    data,
  };
}

async function deliverWithRetries(hook: Hook, event: WebhookEvent, data: Record<string, unknown>) {
  const deliveryId = newId("whd");
  const body = JSON.stringify(envelope(event, data, deliveryId));

  for (let attempt = 1; attempt <= BACKOFF_MS.length; attempt += 1) {
    const wait = BACKOFF_MS[attempt - 1] ?? 0;
    if (wait > 0) await sleep(wait);

    const result = await attemptDelivery(hook, event, body);
    await recordAttempt(hook, event, data, attempt, result);

    if (result.succeeded) {
      await markHealthy(hook.id, result.statusCode ?? 200);
      return;
    }
    // 4xx other than 408 and 429 means the endpoint understood us and said
    // no. Repeating it will not change the answer.
    if (result.statusCode && result.statusCode >= 400 && result.statusCode < 500) {
      if (result.statusCode !== 408 && result.statusCode !== 429) break;
    }
  }

  await markFailed(hook.id, "Gave up after repeated failures");
}

interface AttemptResult {
  succeeded: boolean;
  statusCode: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
}

async function attemptDelivery(
  hook: Hook,
  event: WebhookEvent,
  body: string,
): Promise<AttemptResult> {
  const started = Date.now();
  const { header } = signPayload(hook.secret, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mailroom-Webhooks/1",
        "X-Mailroom-Event": event,
        "X-Mailroom-Signature": header,
        "X-Mailroom-Webhook-Id": hook.id,
      },
      body,
      signal: controller.signal,
      redirect: "manual",
    });

    const text = await response.text().catch(() => "");
    return {
      succeeded: response.ok,
      statusCode: response.status,
      responseBody: text.slice(0, RESPONSE_SNIPPET) || null,
      error: response.ok ? null : `Endpoint replied ${response.status}`,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      succeeded: false,
      statusCode: null,
      responseBody: null,
      error: error instanceof Error ? error.message : "The endpoint could not be reached",
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function recordAttempt(
  hook: Hook,
  event: WebhookEvent,
  data: Record<string, unknown>,
  attempt: number,
  result: AttemptResult,
) {
  try {
    await db.insert(webhookDelivery).values({
      id: newId("whd"),
      webhookId: hook.id,
      organizationId: hook.organizationId,
      event,
      payload: data,
      attempt,
      statusCode: result.statusCode,
      responseBody: result.responseBody,
      error: result.error,
      durationMs: result.durationMs,
      succeeded: result.succeeded,
    });
  } catch (error) {
    console.error("could not record a webhook attempt", error);
  }
}

async function markHealthy(hookId: string, status: number) {
  await db
    .update(webhook)
    .set({ lastStatus: status, lastDeliveredAt: new Date(), consecutiveFailures: 0 })
    .where(eq(webhook.id, hookId))
    .catch(() => {});
}

async function markFailed(hookId: string, reason: string) {
  const [row] = await db
    .update(webhook)
    .set({
      lastError: reason,
      lastErrorAt: new Date(),
      consecutiveFailures: sql`${webhook.consecutiveFailures} + 1`,
    })
    .where(eq(webhook.id, hookId))
    .returning({ failures: webhook.consecutiveFailures })
    .catch(() => [] as { failures: number }[]);

  if (row && row.failures >= DISABLE_AFTER) {
    await db
      .update(webhook)
      .set({ enabled: false, lastError: `${reason}. Turned off after ${row.failures} failures.` })
      .where(eq(webhook.id, hookId))
      .catch(() => {});
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sends a stored delivery's payload again, as a fresh attempt. */
export async function replayDelivery(orgId: string, deliveryId: string) {
  const [row] = await db
    .select()
    .from(webhookDelivery)
    .where(and(eq(webhookDelivery.id, deliveryId), eq(webhookDelivery.organizationId, orgId)))
    .limit(1);
  if (!row) return null;

  const [hook] = await db
    .select()
    .from(webhook)
    .where(and(eq(webhook.id, row.webhookId), eq(webhook.organizationId, orgId)))
    .limit(1);
  if (!hook) return null;

  const body = JSON.stringify(envelope(row.event as WebhookEvent, row.payload, newId("whd")));
  const result = await attemptDelivery(hook, row.event as WebhookEvent, body);
  await recordAttempt(hook, row.event as WebhookEvent, row.payload, row.attempt + 1, result);
  if (result.succeeded) await markHealthy(hook.id, result.statusCode ?? 200);
  return result;
}

/** A test call, so an endpoint can be checked the moment it is added. */
export async function pingWebhook(orgId: string, hookId: string) {
  const [hook] = await db
    .select()
    .from(webhook)
    .where(and(eq(webhook.id, hookId), eq(webhook.organizationId, orgId)))
    .limit(1);
  if (!hook) return null;

  const data = { message: "This is a test event from Mailroom." };
  const body = JSON.stringify(envelope("email.sent", data, newId("whd")));
  const result = await attemptDelivery(hook, "email.sent", body);
  await recordAttempt(hook, "email.sent", data, 1, result);
  if (result.succeeded) await markHealthy(hook.id, result.statusCode ?? 200);
  return result;
}
