import { db } from "@/db";
import { mailbox } from "@/db/schema";
import { type EmailAddress, parseAddress, parseAddressList } from "@/lib/mail";
import type { MimeAttachment } from "@/lib/mime";
import { authenticateApiKey } from "@/server/api-auth";
import { SendError, deliverMessage } from "@/server/send";
import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addresses = z.union([z.string(), z.array(z.string())]);

const bodySchema = z.object({
  from: z.string().min(3),
  to: addresses,
  cc: addresses.optional(),
  bcc: addresses.optional(),
  reply_to: z.string().optional(),
  subject: z.string().default(""),
  html: z.string().optional(),
  text: z.string().optional(),
  headers: z.record(z.string()).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1),
        /** Base64 file contents. */
        content: z.string().min(1),
        content_type: z.string().optional(),
        /** Set to embed the file as an inline cid: image. */
        content_id: z.string().optional(),
      }),
    )
    .optional(),
});

function toList(value: z.infer<typeof addresses> | undefined): EmailAddress[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(", ") : value;
  return parseAddressList(raw);
}

/**
 * POST /api/v1/emails
 *
 * Bearer-authenticated send endpoint. The request shape follows the common
 * transactional-email convention, so existing SDK calls port over with only a
 * base-URL change.
 */
export async function POST(request: NextRequest) {
  const caller = await authenticateApiKey(request);
  if (!caller) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (error) {
    const detail =
      error instanceof z.ZodError ? error.issues.map((i) => i.message).join(", ") : "Invalid JSON";
    return NextResponse.json({ error: detail }, { status: 422 });
  }

  const fromAddress = parseAddress(parsed.from).address;
  const box = await db.query.mailbox.findFirst({
    where: and(eq(mailbox.address, fromAddress), eq(mailbox.userId, caller.userId)),
  });
  if (!box) {
    return NextResponse.json(
      { error: `No mailbox on this account sends as ${fromAddress}` },
      { status: 403 },
    );
  }
  if (caller.mailboxId && caller.mailboxId !== box.id) {
    return NextResponse.json(
      { error: "This API key is locked to a different mailbox" },
      { status: 403 },
    );
  }

  const attachments: MimeAttachment[] = (parsed.attachments ?? []).map((file) => ({
    filename: file.filename,
    content: Buffer.from(file.content, "base64"),
    contentType: file.content_type,
    cid: file.content_id,
  }));

  try {
    const result = await deliverMessage({
      userId: caller.userId,
      mailboxId: box.id,
      to: toList(parsed.to),
      cc: toList(parsed.cc),
      bcc: toList(parsed.bcc),
      replyTo: parsed.reply_to,
      subject: parsed.subject,
      html: parsed.html ?? null,
      text: parsed.text ?? null,
      headers: parsed.headers,
      inlineAttachments: attachments,
      apiKeyId: caller.keyId,
    });

    return NextResponse.json(
      {
        id: result.messageId,
        message_id: result.rfcMessageId,
        ses_message_id: result.sesMessageId,
        thread_id: result.threadId,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof SendError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("api send failed", error);
    return NextResponse.json({ error: "Could not send the message" }, { status: 500 });
  }
}
