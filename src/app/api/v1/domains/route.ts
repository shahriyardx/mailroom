import { db } from "@/db";
import { domain } from "@/db/schema";
import { fail, ok, page, readBody } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { serializeDomain } from "@/server/api-serialize";
import { addDomain, listDomainsForUser } from "@/server/domains";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/domains — what this account can send from, and the DNS it needs. */
export const GET = apiRoute("domains:read", async ({ caller }) => {
  const rows = await listDomainsForUser(caller.orgId);
  return page(rows.map(serializeDomain), null);
});

const createSchema = z.object({ name: z.string().min(3) });

/**
 * POST /api/v1/domains — create the identity in SES and return the records
 * that have to be published before it will send.
 *
 * A subdomain of a domain already verified here is recorded as covered by its
 * parent and needs no DNS of its own.
 */
export const POST = apiRoute("domains:write", async ({ caller, request }) => {
  const input = await readBody(request, createSchema);

  try {
    const created = await addDomain(caller.orgId, input.name);
    const [row] = await db.select().from(domain).where(eq(domain.id, created.id));
    if (!row) return fail("server_error", "The domain was created but could not be read back");
    return ok(serializeDomain(row), 201);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The domain could not be added";
    // "already here" and "does not look like a domain" are both the caller's
    // to fix, and neither is a fault of this server.
    return fail(detail.includes("already") ? "conflict" : "invalid_request", detail);
  }
});
