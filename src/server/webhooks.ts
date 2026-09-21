import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { webhook, webhookDelivery } from "@/db/schema";
import { newId } from "@/lib/utils";
import type { WebhookEvent } from "@/lib/webhook-events";

/**
 * A test sent from the settings screen. Not in WEBHOOK_EVENTS, because it is
 * not something an endpoint subscribes to — and sending a test under a real
 * event name would have a receiver record a delivery that never happened.
 */
export const TEST_EVENT = "webhook.test" as const;

type EventName = WebhookEvent | typeof TEST_EVENT;
import { and, eq, sql } from "drizzle-orm";

// The event names live in lib so the settings screen can list them without
// pulling this module, and the database, into the browser bundle.
export { WEBHOOK_EVENTS, isWebhookEvent, type WebhookEvent } from "@/lib/webhook-events";

/* -------------------------------------------------------------------------- */
/* Where an endpoint is allowed to point                                      */
/* -------------------------------------------------------------------------- */

/** Hosts that only ever mean "something inside the network this runs on". */
const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (METADATA_HOSTS.has(host)) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".internal") || host.endsWith(".local")) return true;

  // IPv6 loopback and the unique-local and link-local ranges.
  if (host === "::1" || host === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;

  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = parts.map(Number) as [number, number, number, number];
    if (a === 127 || a === 0 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
  }

  return false;
}

/**
 * Whether an endpoint may be pointed at this URL.
 *
 * A webhook is fetched by this server and the reply is stored where the key
 * holder can read it, so an unchecked URL is a way to read whatever this
 * container can reach — a database admin page, a cloud metadata service —
 * from outside. Private and loopback addresses are refused; localhost is
 * allowed off production, because a local receiver is how one is tried out.
 *
 * This is not airtight: a name that resolves to a private address passes.
 * It stops the direct attempt, which is the one somebody actually makes.
 */
export function checkWebhookUrl(
  raw: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "That is not a URL" };
  }

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const development = process.env.NODE_ENV !== "production";

  if (url.protocol !== "https:" && !(local && development)) {
    return { ok: false, reason: "A webhook URL must be https" };
  }

  if (isPrivateHost(url.hostname) && !(local && development)) {
    return {
      ok: false,
      reason: "A webhook URL must point at a public address, not one inside the network",
    };
  }

  return { ok: true, url };
}

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

function envelope(event: EventName, data: Record<string, unknown>, deliveryId: string) {
  return {
    id: deliveryId,
    object: "event",
    type: event,
    created_at: new Date().toISOString(),
    data,
  };
}

async function deliverWithRetries(hook: Hook, event: EventName, data: Record<string, unknown>) {
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

async function attemptDelivery(hook: Hook, event: EventName, body: string): Promise<AttemptResult> {
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
  event: EventName,
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

  const body = JSON.stringify(envelope(row.event as EventName, row.payload, newId("whd")));
  const result = await attemptDelivery(hook, row.event as EventName, body);
  await recordAttempt(hook, row.event as EventName, row.payload, row.attempt + 1, result);
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
  const body = JSON.stringify(envelope(TEST_EVENT, data, newId("whd")));
  const result = await attemptDelivery(hook, TEST_EVENT, body);
  await recordAttempt(hook, TEST_EVENT, data, 1, result);
  if (result.succeeded) await markHealthy(hook.id, result.statusCode ?? 200);
  return result;
}
