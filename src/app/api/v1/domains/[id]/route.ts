import { db } from "@/db";
import { domain } from "@/db/schema";
import { boolOf, fail, ok } from "@/lib/api-http";
import { type ApiCaller, apiRoute } from "@/server/api-auth";
import { serializeDomain } from "@/server/api-serialize";
import { removeDomain } from "@/server/domains";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The domain, by id or by name, if this key reaches it. */
async function findDomain(caller: ApiCaller, given: string) {
  const row =
    (await db.query.domain.findFirst({
      where: and(eq(domain.id, given), eq(domain.organizationId, caller.orgId)),
    })) ??
    // A name is what somebody has to hand, so accept one in place of an id.
    (await db.query.domain.findFirst({
      where: and(
        eq(domain.name, given.toLowerCase().trim()),
        eq(domain.organizationId, caller.orgId),
      ),
    })) ??
    null;

  if (!row) return null;
  if (!caller.reach.unrestricted && !caller.reach.domainIds.includes(row.id)) return null;
  return row;
}

/** GET /api/v1/domains/:id — by id or by name. */
export const GET = apiRoute<{ id: string }>("domains:read", async ({ caller, params }) => {
  const row = await findDomain(caller, params.id);
  if (!row) return fail("not_found", "No such domain");
  return ok(serializeDomain(row));
});

/**
 * DELETE /api/v1/domains/:id
 *
 * Removes it here. Add `?delete_in_ses=true` to delete the SES identity too,
 * which cannot be undone and which other instances may be relying on.
 */
export const DELETE = apiRoute<{ id: string }>("domains:write", async ({ caller, params, url }) => {
  const row = await findDomain(caller, params.id);
  if (!row) return fail("not_found", "No such domain");

  const alsoSes = boolOf(url, "delete_in_ses") ?? false;
  await removeDomain(caller.orgId, row.id, alsoSes);

  return ok({
    object: "domain",
    id: row.id,
    name: row.name,
    deleted: true,
    deleted_in_ses: alsoSes,
  });
});
