import { db } from "@/db";
import { suppression } from "@/db/schema";
import { limitOf, makeCursor, ok, page, readBody, splitCursor } from "@/lib/api-http";
import { newId } from "@/lib/utils";
import { apiRoute } from "@/server/api-auth";
import { serializeSuppression } from "@/server/api-serialize";
import { and, asc, desc, eq, gt, ilike, lt, or } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/suppressions — addresses this account will not send to again,
 * filled in automatically by bounces and complaints.
 */
export const GET = apiRoute("suppressions:read", async ({ caller, url }) => {
  const limit = limitOf(url);
  const filters = [eq(suppression.organizationId, caller.orgId)];

  const query = url.searchParams.get("q")?.trim();
  if (query) filters.push(ilike(suppression.address, `%${query}%`));

  const cursor = splitCursor(url.searchParams.get("next_cursor") ?? url.searchParams.get("cursor"));
  if (cursor) {
    const [stamp, id] = cursor;
    const at = new Date(Number(stamp));
    filters.push(
      or(
        lt(suppression.createdAt, at),
        and(eq(suppression.createdAt, at), gt(suppression.id, id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(suppression)
    .where(and(...filters))
    .orderBy(desc(suppression.createdAt), asc(suppression.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return page(
    items.map(serializeSuppression),
    hasMore && last ? makeCursor(last.createdAt, last.id) : null,
  );
});

const createSchema = z.object({
  address: z.string().email(),
  reason: z.string().max(200).optional(),
});

/** POST /api/v1/suppressions — block an address by hand. */
export const POST = apiRoute("suppressions:write", async ({ caller, request }) => {
  const input = await readBody(request, createSchema);
  const address = input.address.toLowerCase().trim();

  const id = newId("sup");
  await db
    .insert(suppression)
    .values({
      id,
      organizationId: caller.orgId,
      address,
      reason: input.reason ?? "Blocked through the API",
    })
    // Blocking an already-blocked address is not an error; it is the state
    // the caller asked for.
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(suppression)
    .where(and(eq(suppression.organizationId, caller.orgId), eq(suppression.address, address)))
    .limit(1);

  return ok(serializeSuppression(row!), row?.id === id ? 201 : 200);
});
