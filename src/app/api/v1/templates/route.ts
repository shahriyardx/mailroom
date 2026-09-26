import { fail, limitOf, makeCursor, ok, page, readBody, splitCursor } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { serializeTemplate } from "@/server/api-serialize";
import { TemplateInvalid, createTemplate, listTemplates } from "@/server/templates";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const templateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  subject: z.string().default(""),
  html: z.string().optional(),
  text: z.string().optional(),
});

/**
 * GET /api/v1/templates — every saved template, by name.
 *
 * There are never many of these, so the whole list comes back in one page.
 * The cursor fields are still here so a client written against the other
 * list endpoints does not have to special-case this one.
 */
export const GET = apiRoute("templates:read", async ({ caller, url }) => {
  const rows = await listTemplates(caller.orgId);
  const limit = limitOf(url, rows.length || 1);

  const cursor = splitCursor(url.searchParams.get("next_cursor") ?? url.searchParams.get("cursor"));
  const start = cursor ? rows.findIndex((row) => row.id === cursor[1]) + 1 : 0;

  const slice = rows.slice(start, start + limit);
  const last = slice.at(-1);
  const more = start + slice.length < rows.length;

  return page(slice.map(serializeTemplate), more && last ? makeCursor(last.name, last.id) : null);
});

/** POST /api/v1/templates — save a new one. */
export const POST = apiRoute("templates:write", async ({ caller, request }) => {
  const input = await readBody(request, templateSchema);

  try {
    const row = await createTemplate(caller.orgId, input);
    return ok(serializeTemplate(row), 201);
  } catch (error) {
    if (error instanceof TemplateInvalid) return fail("invalid_request", error.message);
    throw error;
  }
});
