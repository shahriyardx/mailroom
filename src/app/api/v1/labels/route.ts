import { db } from "@/db";
import { label } from "@/db/schema";
import { fail, ok, page, readBody } from "@/lib/api-http";
import { newId } from "@/lib/utils";
import { apiRoute } from "@/server/api-auth";
import { serializeLabel } from "@/server/api-serialize";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/labels */
export const GET = apiRoute("labels:read", async ({ caller }) => {
  const rows = await db
    .select()
    .from(label)
    .where(eq(label.organizationId, caller.orgId))
    .orderBy(asc(label.name));
  return page(rows.map(serializeLabel), null);
});

const createSchema = z.object({
  name: z.string().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "color must be a hex value like #64748b")
    .optional(),
});

/** POST /api/v1/labels */
export const POST = apiRoute("labels:write", async ({ caller, request }) => {
  const input = await readBody(request, createSchema);
  const name = input.name.trim();

  const id = newId("lbl");
  try {
    await db.insert(label).values({
      id,
      organizationId: caller.orgId,
      name,
      color: input.color ?? "#64748b",
    });
  } catch (error) {
    // 23505 is a unique violation: one name per company. Anything else is
    // ours to own, not the caller's to be told they repeated themselves.
    if (isUniqueViolation(error)) {
      return fail("conflict", `A label called "${name}" already exists`);
    }
    throw error;
  }

  const [row] = await db.select().from(label).where(eq(label.id, id));
  return ok(serializeLabel(row!), 201);
});

/** Postgres reports a broken unique index as SQLSTATE 23505. */
function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
