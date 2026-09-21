import { db } from "@/db";
import { mailbox, message, thread } from "@/db/schema";
import { fail, ok, readBody } from "@/lib/api-http";
import { parseAddress, quoteForReply, replySubject } from "@/lib/mail";
import { apiRoute, callerMailboxIds } from "@/server/api-auth";
import { sendOne, toList } from "@/server/api-send";
import { SendError } from "@/server/send";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const replySchema = z.object({
  text: z.string().optional(),
  html: z.string().optional(),
  /** Reply to everyone the last message went to, not only its sender. */
  reply_all: z.boolean().optional(),
  /** Override the recipients entirely. */
  to: z.union([z.string(), z.array(z.string())]).optional(),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
  bcc: z.union([z.string(), z.array(z.string())]).optional(),
  subject: z.string().optional(),
  /** Append the message being answered, the way a desktop client does. */
  quote: z.boolean().optional(),
  headers: z.record(z.string()).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1),
        content: z.string().min(1),
        content_type: z.string().optional(),
        content_id: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * POST /api/v1/threads/:id/reply
 *
 * Answers a conversation without having to work out who to write to, what to
 * call it, or which headers keep it in the same thread. All of that is read
 * off the last message and can be overridden field by field.
 */
export const POST = apiRoute<{ id: string }>("mail:write", async ({ caller, params, request }) => {
  const input = await readBody(request, replySchema);

  if (!input.text?.trim() && !input.html?.trim()) {
    return fail("invalid_request", "A reply needs text or html");
  }

  const mailboxIds = await callerMailboxIds(caller);
  if (mailboxIds.length === 0) return fail("not_found", "No such thread");

  const row = await db.query.thread.findFirst({
    where: and(eq(thread.id, params.id), inArray(thread.mailboxId, mailboxIds)),
  });
  if (!row) return fail("not_found", "No such thread");

  const [box] = await db.select().from(mailbox).where(eq(mailbox.id, row.mailboxId)).limit(1);
  if (!box) return fail("not_found", "The mailbox this thread belongs to is gone");

  const history = await db.query.message.findMany({
    where: eq(message.threadId, row.id),
    orderBy: (m, { asc }) => [asc(m.receivedAt)],
  });
  const last = history.at(-1);
  if (!last) return fail("conflict", "There is nothing in this thread to reply to");

  // Who the answer goes to. An explicit `to` wins; otherwise it is whoever
  // asked to be replied to, or the sender — and on reply_all, everybody else
  // on the message except ourselves.
  const explicit = input.to ? toList(input.to) : [];
  const answering = last.replyTo
    ? [parseAddress(last.replyTo)]
    : [{ name: last.fromName, address: last.fromAddress }];

  const to = explicit.length > 0 ? explicit : answering;

  const mine = new Set([box.address.toLowerCase()]);
  const others = input.reply_all
    ? [...last.to, ...last.cc].filter(
        (entry) =>
          !mine.has(entry.address.toLowerCase()) &&
          !to.some((target) => target.address.toLowerCase() === entry.address.toLowerCase()),
      )
    : [];

  const cc = input.cc ? toList(input.cc) : others;

  const quote =
    (input.quote ?? true) && (last.htmlBody || last.textBody)
      ? quoteForReply({
          fromLabel: last.fromName ? `${last.fromName} <${last.fromAddress}>` : last.fromAddress,
          sentAt: last.sentAt ?? last.receivedAt,
          html: last.htmlBody,
          text: last.textBody,
        })
      : "";

  const html = input.html?.trim() ? `${input.html}${quote}` : undefined;

  try {
    const result = await sendOne(caller, {
      from: box.address,
      to: to.map((entry) => entry.address),
      cc: cc.map((entry) => entry.address),
      bcc: input.bcc ? toList(input.bcc).map((entry) => entry.address) : undefined,
      subject: input.subject ?? replySubject(row.subject || last.subject),
      text: input.text,
      html,
      headers: input.headers,
      thread_id: row.id,
      in_reply_to: last.rfcMessageId ?? undefined,
      // References is the whole chain so far plus what we are answering, which
      // is what keeps the conversation together in the recipient's client.
      references: [...last.references, last.rfcMessageId].filter((value): value is string =>
        Boolean(value),
      ),
      attachments: input.attachments,
    });
    return ok(result, 202);
  } catch (error) {
    if (error instanceof SendError) {
      return fail(
        error.status === 403
          ? "forbidden"
          : error.status === 409
            ? "conflict"
            : error.status >= 500
              ? "server_error"
              : "invalid_request",
        error.message,
      );
    }
    throw error;
  }
});
