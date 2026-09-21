import { db } from "@/db";
import { folderEnum, label, mailbox, message, thread, threadLabel } from "@/db/schema";
import { boolOf, fail, ok, readBody } from "@/lib/api-http";
import { recomputeThread } from "@/server/aggregate";
import { apiRoute, callerMailboxIds } from "@/server/api-auth";
import { serializeMessage, serializeThread } from "@/server/api-serialize";
import { publish } from "@/server/realtime";
import { dispatchWebhooks } from "@/server/webhooks";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Folder = (typeof folderEnum.enumValues)[number];

/** The thread, if this key may reach it. */
async function findThread(orgId: string, mailboxIds: string[], threadId: string) {
  if (mailboxIds.length === 0) return null;
  const row = await db.query.thread.findFirst({
    where: and(eq(thread.id, threadId), inArray(thread.mailboxId, mailboxIds)),
  });
  return row ?? null;
}

/**
 * GET /api/v1/threads/:id — the conversation and every message in it, bodies
 * and attachments included.
 *
 * Pass `?include_body=false` for a lighter reply when only the shape of the
 * thread is wanted.
 */
export const GET = apiRoute<{ id: string }>("mail:read", async ({ caller, params, url }) => {
  const mailboxIds = await callerMailboxIds(caller);
  const row = await findThread(caller.orgId, mailboxIds, params.id);
  if (!row) return fail("not_found", "No such thread");

  const includeBody = boolOf(url, "include_body") ?? true;

  const detail = await db.query.thread.findFirst({
    where: eq(thread.id, row.id),
    with: {
      mailbox: true,
      messages: {
        orderBy: (m, { asc }) => [asc(m.receivedAt)],
        with: { attachments: true },
      },
      labels: { with: { label: true } },
    },
  });
  if (!detail) return fail("not_found", "No such thread");

  return ok(
    serializeThread(detail, {
      mailboxAddress: detail.mailbox.address,
      mailboxColor: detail.mailbox.color,
      domain: detail.mailbox.domain,
      labels: detail.labels.map((entry) => entry.label),
      messages: detail.messages.map((item) =>
        serializeMessage(item, {
          includeBody,
          attachments: item.attachments,
          mailboxAddress: detail.mailbox.address,
        }),
      ),
    }),
  );
});

const patchSchema = z
  .object({
    folder: z.enum(folderEnum.enumValues).optional(),
    is_read: z.boolean().optional(),
    is_starred: z.boolean().optional(),
    add_labels: z.array(z.string()).optional(),
    remove_labels: z.array(z.string()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change" });

/**
 * PATCH /api/v1/threads/:id — move, read, star and label in one call.
 *
 * Every field is optional and only what is sent is changed, so a client can
 * archive and mark read together without reading the thread back first.
 */
export const PATCH = apiRoute<{ id: string }>("mail:write", async ({ caller, params, request }) => {
  const input = await readBody(request, patchSchema);
  const mailboxIds = await callerMailboxIds(caller);
  const row = await findThread(caller.orgId, mailboxIds, params.id);
  if (!row) return fail("not_found", "No such thread");

  // Labels are resolved and checked before anything is written. Reporting an
  // unknown label after the thread has already been moved would leave the
  // caller with a 422 and a change they did not get told about.
  const wanted = [...(input.add_labels ?? []), ...(input.remove_labels ?? [])];
  let adding: string[] = [];
  let removing: string[] = [];

  if (wanted.length > 0) {
    const owned = await db
      .select({ id: label.id, name: label.name })
      .from(label)
      .where(eq(label.organizationId, caller.orgId));

    // Labels may be named as well as identified, because an id is not
    // something a script writer has to hand.
    const resolve = (given: string) =>
      owned.find((entry) => entry.id === given || entry.name === given)?.id ?? null;

    const unknown = wanted.filter((given) => resolve(given) === null);
    if (unknown.length > 0) {
      return fail("invalid_request", `No such label: ${unknown.join(", ")}`);
    }

    adding = (input.add_labels ?? []).map(resolve).filter((id): id is string => id !== null);
    removing = (input.remove_labels ?? []).map(resolve).filter((id): id is string => id !== null);
  }

  if (input.folder) {
    // Drafts stay where they are: moving one into the archive would lose the
    // only place the composer looks for it.
    await db
      .update(message)
      .set({ folder: input.folder as Folder })
      .where(and(eq(message.threadId, row.id), eq(message.isDraft, false)));
  }

  if (input.is_read !== undefined) {
    await db.update(message).set({ isRead: input.is_read }).where(eq(message.threadId, row.id));
  }

  if (input.is_starred !== undefined) {
    await db
      .update(message)
      .set({ isStarred: input.is_starred })
      .where(eq(message.threadId, row.id));
    await db.update(thread).set({ isStarred: input.is_starred }).where(eq(thread.id, row.id));
  }

  if (adding.length > 0) {
    await db
      .insert(threadLabel)
      .values(adding.map((labelId) => ({ threadId: row.id, labelId })))
      .onConflictDoNothing();
  }
  if (removing.length > 0) {
    await db
      .delete(threadLabel)
      .where(and(eq(threadLabel.threadId, row.id), inArray(threadLabel.labelId, removing)));
  }

  await recomputeThread(row.id);
  await publish({
    type: "mail:changed",
    orgId: caller.orgId,
    mailboxId: row.mailboxId,
    threadId: row.id,
  });

  const [box] = await db
    .select({ address: mailbox.address, color: mailbox.color, domain: mailbox.domain })
    .from(mailbox)
    .where(eq(mailbox.id, row.mailboxId));

  const updated = await db.query.thread.findFirst({ where: eq(thread.id, row.id) });
  if (!updated) return fail("not_found", "The thread was removed while it was being changed");

  const labels = await db
    .select({ row: label })
    .from(threadLabel)
    .innerJoin(label, eq(label.id, threadLabel.labelId))
    .where(eq(threadLabel.threadId, row.id));

  const body = serializeThread(updated, {
    mailboxAddress: box?.address,
    mailboxColor: box?.color,
    domain: box?.domain,
    labels: labels.map((entry) => entry.row),
  });

  void dispatchWebhooks(
    caller.orgId,
    "thread.updated",
    { thread: body },
    {
      mailboxId: row.mailboxId,
    },
  );

  return ok(body);
});

/**
 * DELETE /api/v1/threads/:id — to the trash, and out of it for good on a
 * second call. `?permanent=true` skips the trash.
 */
export const DELETE = apiRoute<{ id: string }>("mail:write", async ({ caller, params, url }) => {
  const mailboxIds = await callerMailboxIds(caller);
  const row = await findThread(caller.orgId, mailboxIds, params.id);
  if (!row) return fail("not_found", "No such thread");

  const permanent =
    (boolOf(url, "permanent") ?? false) || (row.folders.length === 1 && row.folders[0] === "trash");

  if (permanent) {
    await db.delete(thread).where(eq(thread.id, row.id));
  } else {
    await db.update(message).set({ folder: "trash" }).where(eq(message.threadId, row.id));
    await recomputeThread(row.id);
  }

  await publish({
    type: "mail:changed",
    orgId: caller.orgId,
    mailboxId: row.mailboxId,
    threadId: row.id,
  });

  return ok({ object: "thread", id: row.id, deleted: true, permanent });
});
