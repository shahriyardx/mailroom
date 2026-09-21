import { fail, ok, readBody } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { serializeTemplate } from "@/server/api-serialize";
import {
  TemplateConflict,
  TemplateInvalid,
  TemplateNotFound,
  deleteTemplate,
  findTemplate,
  updateTemplate,
} from "@/server/templates";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).max(60).optional(),
  description: z.string().nullable().optional(),
  subject: z.string().optional(),
  html: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
});

/** GET /api/v1/templates/:id — by id or by slug, since both are names for it. */
export const GET = apiRoute<{ id: string }>("templates:read", async ({ caller, params }) => {
  const row = await findTemplate(caller.orgId, params.id);
  if (!row) return fail("not_found", "No such template");
  return ok(serializeTemplate(row));
});

/** PATCH /api/v1/templates/:id — change what is given, leave the rest. */
export const PATCH = apiRoute<{ id: string }>(
  "templates:write",
  async ({ caller, params, request }) => {
    const input = await readBody(request, patchSchema);

    try {
      const row = await updateTemplate(caller.orgId, params.id, input);
      return ok(serializeTemplate(row));
    } catch (error) {
      if (error instanceof TemplateNotFound) return fail("not_found", "No such template");
      if (error instanceof TemplateConflict) return fail("conflict", error.message);
      if (error instanceof TemplateInvalid) return fail("invalid_request", error.message);
      throw error;
    }
  },
);

/** DELETE /api/v1/templates/:id */
export const DELETE = apiRoute<{ id: string }>("templates:write", async ({ caller, params }) => {
  const removed = await deleteTemplate(caller.orgId, params.id);
  if (!removed) return fail("not_found", "No such template");
  return ok({ object: "template", id: params.id, deleted: true });
});
