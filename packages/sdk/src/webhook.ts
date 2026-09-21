import { WebhookVerificationError } from "./errors.js";
import type { DeliveryStatus, EmailAddress, Folder, Thread, WebhookEventName } from "./types.js";

/**
 * Receiving events.
 *
 * Every call Mailroom makes to your endpoint carries three headers:
 *
 * - `X-Mailroom-Event` — the event name
 * - `X-Mailroom-Signature` — `t=<unix seconds>,v1=<hex>`
 * - `X-Mailroom-Webhook-Id` — which endpoint this came from
 *
 * The signature is an HMAC-SHA256 over `` `${t}.${rawBody}` `` keyed with the
 * endpoint's secret. **Check it against the raw body**, not a re-serialised
 * object: `JSON.parse` followed by `JSON.stringify` does not always give back
 * the same bytes, and the signature is over bytes.
 */

/** The envelope every event is wrapped in. */
export interface WebhookEventEnvelope<T = Record<string, unknown>> {
  /** Also the delivery id, so a repeat can be ignored. */
  id: string;
  object: "event";
  type: WebhookEventName | "webhook.test";
  created_at: string;
  data: T;
}

/** The message summary sent with an inbound event. */
export interface ReceivedEmail {
  id: string;
  thread_id: string;
  mailbox_id: string;
  mailbox: string;
  message_id: string | null;
  from: EmailAddress;
  to: EmailAddress[];
  /** The address this copy was actually delivered to. */
  delivered_to: string;
  subject: string;
  snippet: string;
  folder: Folder;
  has_attachments: boolean;
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  spam_score: number | null;
  received_at: string;
}

/** The message summary sent when one is handed to SES. */
export interface SentEmailSummary {
  id: string;
  thread_id: string;
  mailbox_id: string;
  mailbox: string;
  ses_message_id: string | null;
  message_id: string | null;
  from: string;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  status: DeliveryStatus;
  api_key_id: string | null;
  sent_at: string;
}

/** The message summary sent with a delivery, bounce, complaint or open. */
export interface DeliveryEmailSummary {
  id: string;
  thread_id: string;
  mailbox_id: string;
  mailbox: string;
  ses_message_id: string | null;
  message_id: string | null;
  from: string;
  to: EmailAddress[];
  subject: string;
  status: DeliveryStatus | null;
}

export type MailroomWebhookEvent =
  | (WebhookEventEnvelope<{ email: ReceivedEmail }> & { type: "mail.received" })
  | (WebhookEventEnvelope<{ email: SentEmailSummary }> & { type: "email.sent" })
  | (WebhookEventEnvelope<{
      email: DeliveryEmailSummary;
      /** The addresses this event was about. */
      recipients: string[];
      /** What SES said, when it said anything. */
      detail: string | null;
      occurred_at: string;
    }> & {
      type:
        | "email.delivered"
        | "email.bounced"
        | "email.complained"
        | "email.opened"
        | "email.delayed"
        | "email.rejected";
    })
  | (WebhookEventEnvelope<{ thread: Thread }> & { type: "thread.updated" })
  | (WebhookEventEnvelope<{ message: string }> & { type: "webhook.test" });

export interface VerifyOptions {
  /** The endpoint's signing secret, from when it was created. */
  secret: string;
  /** The **raw** request body, exactly as it arrived. */
  payload: string | Uint8Array | ArrayBuffer;
  /** The `X-Mailroom-Signature` header. */
  signature: string | null | undefined;
  /**
   * How far the timestamp may be from now, in seconds. Default 300, matching
   * the server. It is what stops an old call being replayed at you.
   */
  toleranceSeconds?: number;
}

/**
 * Whether a body really came from your Mailroom instance.
 *
 * ```ts
 * const raw = await request.text();
 * const ok = await verifyWebhook({
 *   secret: process.env.MAILROOM_WEBHOOK_SECRET!,
 *   payload: raw,
 *   signature: request.headers.get("x-mailroom-signature"),
 * });
 * ```
 */
export async function verifyWebhook(options: VerifyOptions): Promise<boolean> {
  const { secret, signature, toleranceSeconds = 300 } = options;
  if (!signature) return false;

  const parts = parseSignature(signature);
  if (!parts) return false;
  if (Math.abs(Date.now() / 1000 - parts.timestamp) > toleranceSeconds) return false;

  const body = toText(options.payload);
  const expected = await hmacHex(secret, `${parts.timestamp}.${body}`);
  return sameString(expected, parts.digest);
}

/**
 * Verifies and parses in one step, the way a handler wants it.
 *
 * Throws {@link WebhookVerificationError} if the signature does not match, so
 * a handler that forgets to check the return value still cannot be fooled.
 */
export async function constructWebhookEvent(options: VerifyOptions): Promise<MailroomWebhookEvent> {
  const valid = await verifyWebhook(options);
  if (!valid) {
    throw new WebhookVerificationError(
      "The webhook signature did not match. Check the secret, and that you are passing the raw request body.",
    );
  }

  try {
    return JSON.parse(toText(options.payload)) as MailroomWebhookEvent;
  } catch {
    throw new WebhookVerificationError("The webhook body is not valid JSON");
  }
}

/**
 * Signs a body the way the server does.
 *
 * Here for tests: it lets you post a realistic call at your own handler
 * without waiting for a real event.
 */
export async function signWebhookPayload(
  secret: string,
  payload: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const digest = await hmacHex(secret, `${timestamp}.${payload}`);
  return `t=${timestamp},v1=${digest}`;
}

function parseSignature(header: string): { timestamp: number; digest: string } | null {
  let timestamp = Number.NaN;
  let digest = "";

  for (const piece of header.split(",")) {
    const at = piece.indexOf("=");
    if (at < 0) continue;
    const name = piece.slice(0, at).trim();
    const value = piece.slice(at + 1).trim();
    if (name === "t") timestamp = Number(value);
    if (name === "v1") digest = value;
  }

  if (!Number.isFinite(timestamp) || digest.length === 0) return null;
  return { timestamp, digest };
}

function toText(payload: string | Uint8Array | ArrayBuffer): string {
  if (typeof payload === "string") return payload;
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  return new TextDecoder().decode(bytes);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("No Web Crypto available. Use Node 18 or newer, or provide globalThis.crypto.");
  }

  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await subtle.sign("HMAC", key, encoder.encode(message));

  let hex = "";
  for (const byte of new Uint8Array(signed)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** Compares in time that does not depend on where the first difference is. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let index = 0; index < a.length; index += 1) {
    different |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return different === 0;
}
