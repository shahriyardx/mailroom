import { db } from "@/db";
import { attachment, mailbox, message, messageEvent } from "@/db/schema";
import { fail, ok, readBody } from "@/lib/api-http";
import { parseSchedule } from "@/lib/schedule";
import { apiRoute, callerMailboxIds } from "@/server/api-auth";
import { serializeMessage } from "@/server/api-serialize";
import { rescheduleSend } from "@/server/scheduling";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/emails/:id — one send, with its body, its files and every SES
 * event seen for it so far.
 *
 * The id is the one returned by POST /api/v1/emails. An SES message id works
 * too, since that is what a webhook or a bounce report hands you.
 */
export const GET = apiRoute<{ id: string }>("emails:read", async ({ caller, params }) => {
  const mailboxIds = await callerMailboxIds(caller);
  if (mailboxIds.length === 0) return fail("not_found", "No such message");

  const row = await db.query.message.findFirst({
    where: and(eq(message.id, params.id), inArray(message.mailboxId, mailboxIds)),
  });

  const found =
    row ??
    (await db.query.message.findFirst({
      where: and(eq(message.sesMessageId, params.id), inArray(message.mailboxId, mailboxIds)),
    }));

  if (!found) return fail("not_found", "No such message");

  const [events, files, [box]] = await Promise.all([
    db.query.messageEvent.findMany({
      where: eq(messageEvent.messageId, found.id),
      orderBy: (e, { asc: ascending }) => [ascending(e.occurredAt)],
    }),
    db
      .select()
      .from(attachment)
      .where(eq(attachment.messageId, found.id))
      .orderBy(asc(attachment.filename)),
    db.select({ address: mailbox.address }).from(mailbox).where(eq(mailbox.id, found.mailboxId)),
  ]);

  return ok(
    serializeMessage(found, {
      includeBody: true,
      events,
      attachments: files,
      mailboxAddress: box?.address,
    }),
  );
});

const patchSchema = z.object({
  /** The new time. Same forms POST /v1/emails accepts. */
  scheduled_at: z.union([z.string(), z.number()]),
});

/**
 * PATCH /api/v1/emails/:id — move a waiting message to a different time.
 *
 * Only while it is still waiting. A message already handed to a worker, or
 * already sent, answers 409.
 */
export const PATCH = apiRoute<{ id: string }>(
  "emails:send",
  async ({ caller, params, request }) => {
    const input = await readBody(request, patchSchema);

    const when = parseSchedule(input.scheduled_at);
    if ("error" in when) return fail("invalid_request", when.error);

    const result = await rescheduleSend(caller, params.id, when.at);
    if (!result.ok) {
      return fail(result.status === 404 ? "not_found" : "conflict", result.reason);
    }
    return ok(serializeMessage(result.message, { mailboxAddress: result.mailboxAddress }));
  },
);
