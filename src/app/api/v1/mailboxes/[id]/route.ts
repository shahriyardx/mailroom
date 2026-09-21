import { db } from "@/db";
import { mailbox } from "@/db/schema";
import { fail, ok, readBody } from "@/lib/api-http";
import { apiRoute, callerMailboxIds } from "@/server/api-auth";
import { serializeMailbox } from "@/server/api-serialize";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findMailbox(orgId: string, reachable: string[], id: string) {
  if (!reachable.includes(id)) return null;
  const row = await db.query.mailbox.findFirst({
    where: and(eq(mailbox.id, id), eq(mailbox.organizationId, orgId)),
  });
  return row ?? null;
}

/** GET /api/v1/mailboxes/:id */
export const GET = apiRoute<{ id: string }>("mailboxes:read", async ({ caller, params }) => {
  const row = await findMailbox(caller.orgId, await callerMailboxIds(caller), params.id);
  if (!row) return fail("not_found", "No such mailbox");
  return ok(serializeMailbox(row));
});

const patchSchema = z
  .object({
    display_name: z.string().min(1).optional(),
    signature: z.string().nullable().optional(),
    is_catch_all: z.boolean().optional(),
    is_default: z.boolean().optional(),
    color: z.string().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change" });

/** PATCH /api/v1/mailboxes/:id — the address itself cannot change; make a new one. */
export const PATCH = apiRoute<{ id: string }>(
  "mailboxes:write",
  async ({ caller, params, request }) => {
    const input = await readBody(request, patchSchema);
    const row = await findMailbox(caller.orgId, await callerMailboxIds(caller), params.id);
    if (!row) return fail("not_found", "No such mailbox");

    await db
      .update(mailbox)
      .set({
        displayName: input.display_name ?? row.displayName,
        signature: input.signature === undefined ? row.signature : input.signature,
        isCatchAll: input.is_catch_all ?? row.isCatchAll,
        isDefault: input.is_default ?? row.isDefault,
        color: input.color ?? row.color,
      })
      .where(eq(mailbox.id, row.id));

    if (input.is_default) {
      await db
        .update(mailbox)
        .set({ isDefault: false })
        .where(and(eq(mailbox.organizationId, caller.orgId), sql`${mailbox.id} <> ${row.id}`));
    }

    const [updated] = await db.select().from(mailbox).where(eq(mailbox.id, row.id));
    return ok(serializeMailbox(updated!));
  },
);

/**
 * DELETE /api/v1/mailboxes/:id
 *
 * This takes the mail in it too, so it refuses unless `?confirm=true` is
 * given. A mistyped id should not empty an inbox.
 */
export const DELETE = apiRoute<{ id: string }>(
  "mailboxes:write",
  async ({ caller, params, url }) => {
    const row = await findMailbox(caller.orgId, await callerMailboxIds(caller), params.id);
    if (!row) return fail("not_found", "No such mailbox");

    if (url.searchParams.get("confirm") !== "true") {
      return fail(
        "conflict",
        "Deleting a mailbox deletes its mail. Repeat with ?confirm=true to go ahead.",
      );
    }

    await db.delete(mailbox).where(eq(mailbox.id, row.id));
    return ok({ object: "mailbox", id: row.id, deleted: true });
  },
);
