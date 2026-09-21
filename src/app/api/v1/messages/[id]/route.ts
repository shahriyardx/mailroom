import { db } from "@/db";
import { attachment, mailbox, message, messageEvent } from "@/db/schema";
import { fail, ok, readBody } from "@/lib/api-http";
import { recomputeThread } from "@/server/aggregate";
import { apiRoute, callerMailboxIds } from "@/server/api-auth";
import { serializeMessage } from "@/server/api-serialize";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findMessage(mailboxIds: string[], id: string) {
  if (mailboxIds.length === 0) return null;
  const row = await db.query.message.findFirst({
    where: and(eq(message.id, id), inArray(message.mailboxId, mailboxIds)),
  });
  return row ?? null;
}

/** GET /api/v1/messages/:id — one message with its body, files and events. */
export const GET = apiRoute<{ id: string }>("mail:read", async ({ caller, params }) => {
  const mailboxIds = await callerMailboxIds(caller);
  const row = await findMessage(mailboxIds, params.id);
  if (!row) return fail("not_found", "No such message");

  const [files, events, [box]] = await Promise.all([
    db
      .select()
      .from(attachment)
      .where(eq(attachment.messageId, row.id))
      .orderBy(asc(attachment.filename)),
    db.query.messageEvent.findMany({
      where: eq(messageEvent.messageId, row.id),
      orderBy: (e, { asc: ascending }) => [ascending(e.occurredAt)],
    }),
    db.select({ address: mailbox.address }).from(mailbox).where(eq(mailbox.id, row.mailboxId)),
  ]);

  return ok(
    serializeMessage(row, {
      includeBody: true,
      attachments: files,
      events,
      mailboxAddress: box?.address,
    }),
  );
});

const patchSchema = z
  .object({
    is_read: z.boolean().optional(),
    is_starred: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change" });

/** PATCH /api/v1/messages/:id — read and star one message, not the thread. */
export const PATCH = apiRoute<{ id: string }>("mail:write", async ({ caller, params, request }) => {
  const input = await readBody(request, patchSchema);
  const mailboxIds = await callerMailboxIds(caller);
  const row = await findMessage(mailboxIds, params.id);
  if (!row) return fail("not_found", "No such message");

  await db
    .update(message)
    .set({
      ...(input.is_read === undefined ? {} : { isRead: input.is_read }),
      ...(input.is_starred === undefined ? {} : { isStarred: input.is_starred }),
    })
    .where(eq(message.id, row.id));

  await recomputeThread(row.threadId);

  const updated = await db.query.message.findFirst({ where: eq(message.id, row.id) });
  if (!updated) return fail("not_found", "No such message");
  return ok(serializeMessage(updated));
});
