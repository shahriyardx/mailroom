import PostalMime, { type Address, type Attachment } from "postal-mime";

export interface Env {
  ATTACHMENTS: R2Bucket;
  APP_INBOUND_URL: string;
  INBOUND_WEBHOOK_SECRET: string;
  STORE_RAW?: string;
  MAX_ATTACHMENT_BYTES?: string;
  /**
   * Optional comma-separated addresses to forward every message on to, on top
   * of storing it. Each must be a verified destination in Email Routing.
   */
  FORWARD_TO?: string;
}

interface StoredAttachment {
  filename: string;
  contentType: string;
  sizeBytes: number;
  r2Key: string;
  contentId: string | null;
  isInline: boolean;
}

function toAddresses(list: Address[] | undefined) {
  return (list ?? []).map((entry) => ({
    name: entry.name || null,
    address: (entry.address ?? "").toLowerCase(),
  }));
}

/** HMAC over "timestamp.body", matching the check in /api/inbound. */
async function sign(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function headerValue(headers: { key: string; value: string }[], name: string) {
  const lower = name.toLowerCase();
  return headers.find((header) => header.key.toLowerCase() === lower)?.value ?? null;
}

function headerValues(headers: { key: string; value: string }[], name: string) {
  const lower = name.toLowerCase();
  return headers
    .filter((header) => header.key.toLowerCase() === lower)
    .map((header) => header.value);
}

/**
 * Cloudflare puts SPF/DKIM/DMARC verdicts in Authentication-Results, and a
 * message that has been relayed carries one header per hop, so prefer the one
 * Cloudflare wrote: an upstream hop's verdict describes a different delivery.
 *
 * Within that header a mechanism can appear more than once. SPF is checked
 * twice — once against the HELO name and once against the envelope sender —
 * and the HELO check is routinely "none" because a mail server's own hostname
 * rarely publishes SPF. The envelope sender is the result that means anything,
 * so it wins. DKIM appears once per signature, and one valid signature is
 * enough.
 */
function splitAuthSegments(raw: string) {
  const segments: string[] = [];
  let depth = 0;
  let current = "";

  // Comments are parenthesised and can themselves contain a semicolon.
  for (const character of raw) {
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);

    if (character === ";" && depth === 0) {
      segments.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) segments.push(current);
  return segments;
}

function parseAuthResults(all: string[]) {
  const raw = all.find((value) => /mx\.cloudflare\.net|cloudflare/i.test(value)) ?? all[0];
  if (!raw) return {};

  const results: { method: string; verdict: string; rest: string }[] = [];
  for (const segment of splitAuthSegments(raw)) {
    const match = segment.match(/^\s*(spf|dkim|dmarc)\s*=\s*([a-z]+)/i);
    if (match) {
      results.push({
        method: match[1]!.toLowerCase(),
        verdict: match[2]!.toLowerCase(),
        rest: segment.slice(match[0].length),
      });
    }
  }

  const of = (method: string) => results.filter((result) => result.method === method);

  const spfResults = of("spf");
  const spf =
    spfResults.find((result) => /smtp\.mailfrom/i.test(result.rest))?.verdict ??
    spfResults.find((result) => result.verdict === "pass")?.verdict ??
    spfResults[0]?.verdict ??
    null;

  const dkimResults = of("dkim");
  const dkim =
    dkimResults.find((result) => result.verdict === "pass")?.verdict ??
    dkimResults[0]?.verdict ??
    null;

  return { spf, dkim, dmarc: of("dmarc")[0]?.verdict ?? null };
}

function parseSpamScore(headers: { key: string; value: string }[]) {
  const raw = headerValue(headers, "x-spam-score") ?? headerValue(headers, "x-spam-status");
  if (!raw) return null;
  const match = raw.match(/-?\d+(\.\d+)?/);
  return match ? Math.round(Number(match[0])) : null;
}

async function storeAttachments(
  env: Env,
  messageKey: string,
  attachments: Attachment[],
): Promise<StoredAttachment[]> {
  const limit = Number(env.MAX_ATTACHMENT_BYTES ?? 26_214_400);
  const stored: StoredAttachment[] = [];

  for (const [index, file] of attachments.entries()) {
    const bytes =
      typeof file.content === "string"
        ? new TextEncoder().encode(file.content)
        : new Uint8Array(file.content);

    if (bytes.byteLength > limit) continue;

    const filename = file.filename || `attachment-${index + 1}`;
    const key = `inbound/${messageKey}/${index}-${filename.replace(/[^\w.\- ]+/g, "_")}`;

    await env.ATTACHMENTS.put(key, bytes, {
      httpMetadata: { contentType: file.mimeType || "application/octet-stream" },
    });

    stored.push({
      filename,
      contentType: file.mimeType || "application/octet-stream",
      sizeBytes: bytes.byteLength,
      r2Key: key,
      contentId: file.contentId ?? null,
      // A Content-ID alone does not make a part inline: Gmail stamps one on
      // ordinary attachments too. An explicit disposition settles it, and a
      // Content-ID only decides the case where there is none.
      isInline:
        file.disposition === "attachment"
          ? false
          : file.disposition === "inline" || Boolean(file.contentId),
    });
  }

  return stored;
}

/** Sends the message on to each verified destination address. */
async function forward(message: ForwardableEmailMessage, addresses: string[]) {
  for (const address of addresses) {
    await message.forward(address);
  }
}

export default {
  /** Cloudflare Email Routing calls this for every message sent to a routed address. */
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    const rawBuffer = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const parsed = await PostalMime.parse(rawBuffer);

    const messageKey = crypto.randomUUID();
    const headers = (parsed.headers ?? []).map((header) => ({
      key: header.key,
      value: header.value,
    }));

    let rawKey: string | null = null;
    if (env.STORE_RAW !== "false") {
      rawKey = `raw/${messageKey}.eml`;
      ctx.waitUntil(
        env.ATTACHMENTS.put(rawKey, rawBuffer, {
          httpMetadata: { contentType: "message/rfc822" },
        }).then(() => undefined),
      );
    }

    const attachments = await storeAttachments(env, messageKey, parsed.attachments ?? []);
    const auth = parseAuthResults(headerValues(headers, "authentication-results"));

    const payload = {
      email: {
        to: message.to.toLowerCase(),
        recipients: [message.to.toLowerCase()],
        from: {
          name: parsed.from?.name || null,
          address: (parsed.from?.address ?? message.from).toLowerCase(),
        },
        toAddresses: toAddresses(parsed.to),
        ccAddresses: toAddresses(parsed.cc),
        replyTo: parsed.replyTo?.[0]?.address ?? null,
        subject: parsed.subject ?? "",
        text: parsed.text ?? null,
        html: parsed.html ?? null,
        messageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references: (parsed.references ?? "")
          .split(/\s+/)
          .map((value) => value.trim())
          .filter(Boolean),
        date: parsed.date ?? new Date().toISOString(),
        sizeBytes: rawBuffer.byteLength,
        rawKey,
        auth,
        spamScore: parseSpamScore(headers),
      },
      attachments,
    };

    const body = JSON.stringify(payload);
    const timestamp = Date.now().toString();
    const signature = await sign(env.INBOUND_WEBHOOK_SECRET, timestamp, body);

    const response = await fetch(env.APP_INBOUND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mail-signature": signature,
        "x-mail-timestamp": timestamp,
      },
      body,
    });

    const forwardTo = (env.FORWARD_TO ?? "")
      .split(",")
      .map((address) => address.trim())
      .filter(Boolean);

    if (response.status === 202) {
      // The app has no mailbox for this address. Forward it if somewhere was
      // configured, rather than bouncing mail we could still deliver.
      if (forwardTo.length > 0) {
        await forward(message, forwardTo);
        return;
      }
      message.setReject("550 5.1.1 No such recipient here");
      return;
    }

    if (!response.ok) {
      // Throwing makes Cloudflare retry delivery instead of silently dropping mail.
      const detail = await response.text().catch(() => "");
      throw new Error(`inbound webhook failed ${response.status}: ${detail.slice(0, 300)}`);
    }

    // Stored successfully. Forwarding happens after, so a forwarding failure
    // retries the whole message; the app deduplicates on Message-ID.
    if (forwardTo.length > 0) await forward(message, forwardTo);
  },

  /** Health check, useful after deploy. */
  async fetch() {
    return new Response("mail-inbound worker ok", { status: 200 });
  },
};
