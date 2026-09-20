import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { type InboundAttachment, type InboundPayload, ingestInbound } from "@/server/ingest";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time HMAC check so the worker is the only thing that can inject mail. */
function verifySignature(rawBody: string, signature: string | null, timestamp: string | null) {
  if (!signature || !timestamp) return false;

  const age = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) return false;

  const expected = createHmac("sha256", env.inboundSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const ok = verifySignature(
    rawBody,
    request.headers.get("x-mail-signature"),
    request.headers.get("x-mail-timestamp"),
  );
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let parsed: { email: InboundPayload; attachments?: InboundAttachment[] };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!parsed.email?.from?.address) {
    return NextResponse.json({ error: "missing sender" }, { status: 400 });
  }

  try {
    const result = await ingestInbound(parsed.email, parsed.attachments ?? []);
    if (result.stored.length === 0) {
      // No local mailbox owns this address; tell the worker so it can reject.
      return NextResponse.json({ stored: 0, reason: "no mailbox" }, { status: 202 });
    }
    return NextResponse.json({ stored: result.stored.length });
  } catch (error) {
    console.error("inbound ingest failed", error);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }
}
