import { db } from "@/db";
import { label } from "@/db/schema";
import { fail, ok, readBody } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { serializeLabel } from "@/server/api-serialize";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findLabel(orgId: string, given: string) {
  const byId = await db.query.label.findFirst({
    where: and(eq(label.id, given), eq(label.organizationId, orgId)),
  });
  if (byId) return byId;
  return (
    (await db.query.label.findFirst({
      where: and(eq(label.name, given), eq(label.organizationId, orgId)),
    })) ?? null
  );
}

/** GET /api/v1/labels/:id — by id or by name. */
export const GET = apiRoute<{ id: string }>("labels:read", async ({ caller, params }) => {
  const row = await findLabel(caller.orgId, params.id);
  if (!row) return fail("not_found", "No such label");
  return ok(serializeLabel(row));
});

const patchSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change" });

/** PATCH /api/v1/labels/:id */
export const PATCH = apiRoute<{ id: string }>(
  "labels:write",
  async ({ caller, params, request }) => {
    const input = await readBody(request, patchSchema);
    const row = await findLabel(caller.orgId, params.id);
    if (!row) return fail("not_found", "No such label");

    try {
      await db
        .update(label)
        .set({ name: input.name?.trim() ?? row.name, color: input.color ?? row.color })
        .where(eq(label.id, row.id));
    } catch {
      return fail("conflict", `A label called "${input.name}" already exists`);
    }

    const [updated] = await db.select().from(label).where(eq(label.id, row.id));
    return ok(serializeLabel(updated!));
  },
);

/** DELETE /api/v1/labels/:id — the label goes, the threads it was on stay. */
export const DELETE = apiRoute<{ id: string }>("labels:write", async ({ caller, params }) => {
  const row = await findLabel(caller.orgId, params.id);
  if (!row) return fail("not_found", "No such label");
  await db.delete(label).where(eq(label.id, row.id));
  return ok({ object: "label", id: row.id, deleted: true });
});
