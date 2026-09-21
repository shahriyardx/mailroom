import { db } from "@/db";
import { suppression } from "@/db/schema";
import { fail, ok } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/v1/suppressions/:id — unblock, by id or by address.
 *
 * Worth knowing: the address was blocked because mail to it bounced or was
 * reported as spam. Sending again risks the account's own reputation.
 */
export const DELETE = apiRoute<{ id: string }>("suppressions:write", async ({ caller, params }) => {
  const given = decodeURIComponent(params.id);

  const row =
    (await db.query.suppression.findFirst({
      where: and(eq(suppression.id, given), eq(suppression.organizationId, caller.orgId)),
    })) ??
    (await db.query.suppression.findFirst({
      where: and(
        eq(suppression.address, given.toLowerCase().trim()),
        eq(suppression.organizationId, caller.orgId),
      ),
    }));

  if (!row) return fail("not_found", "That address is not blocked");

  await db.delete(suppression).where(eq(suppression.id, row.id));
  return ok({ object: "suppression", id: row.id, address: row.address, deleted: true });
});
