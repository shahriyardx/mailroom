import { db } from "@/db";
import { contact } from "@/db/schema";
import { limitOf, makeCursor, page, splitCursor } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { serializeContact } from "@/server/api-serialize";
import { and, asc, desc, eq, gt, ilike, lt, or } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/contacts — everyone this account has written to or heard from,
 * most recently seen first.
 *
 * Filters: `q` (matches address or name), `order` (`recent` or `frequent`).
 */
export const GET = apiRoute("contacts:read", async ({ caller, url }) => {
  const limit = limitOf(url);
  const filters = [eq(contact.organizationId, caller.orgId)];

  const query = url.searchParams.get("q")?.trim();
  if (query) {
    filters.push(or(ilike(contact.address, `%${query}%`), ilike(contact.name, `%${query}%`))!);
  }

  const frequent = url.searchParams.get("order") === "frequent";

  const cursor = splitCursor(url.searchParams.get("next_cursor") ?? url.searchParams.get("cursor"));
  if (cursor) {
    const [left, id] = cursor;
    if (frequent) {
      const count = Number(left);
      filters.push(
        or(
          lt(contact.messageCount, count),
          and(eq(contact.messageCount, count), gt(contact.id, id)),
        )!,
      );
    } else {
      const at = new Date(Number(left));
      filters.push(
        or(lt(contact.lastSeenAt, at), and(eq(contact.lastSeenAt, at), gt(contact.id, id)))!,
      );
    }
  }

  const rows = await db
    .select()
    .from(contact)
    .where(and(...filters))
    .orderBy(frequent ? desc(contact.messageCount) : desc(contact.lastSeenAt), asc(contact.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return page(
    items.map(serializeContact),
    hasMore && last ? makeCursor(frequent ? last.messageCount : last.lastSeenAt, last.id) : null,
  );
});
