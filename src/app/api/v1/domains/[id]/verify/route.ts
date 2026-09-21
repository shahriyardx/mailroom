import { db } from "@/db";
import { domain } from "@/db/schema";
import { fail, ok } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { serializeDomain } from "@/server/api-serialize";
import { refreshDomain } from "@/server/domains";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/domains/:id/verify
 *
 * Asks SES where the identity stands and probes SPF and DMARC in DNS, then
 * returns the domain as it now is. This is what a setup script polls after
 * publishing records.
 */
export const POST = apiRoute<{ id: string }>("domains:write", async ({ caller, params }) => {
  const row =
    (await db.query.domain.findFirst({
      where: and(eq(domain.id, params.id), eq(domain.organizationId, caller.orgId)),
    })) ??
    (await db.query.domain.findFirst({
      where: and(
        eq(domain.name, params.id.toLowerCase().trim()),
        eq(domain.organizationId, caller.orgId),
      ),
    })) ??
    null;

  // A key that reaches some domains may re-check those, and no others.
  if (row && !caller.reach.unrestricted && !caller.reach.domainIds.includes(row.id)) {
    return fail("not_found", "No such domain");
  }
  if (!row) return fail("not_found", "No such domain");

  try {
    await refreshDomain(caller.orgId, row.id);
  } catch (error) {
    return fail(
      "server_error",
      error instanceof Error ? error.message : "SES could not be reached",
    );
  }

  const [updated] = await db.select().from(domain).where(eq(domain.id, row.id));
  return ok(serializeDomain(updated ?? row));
});
