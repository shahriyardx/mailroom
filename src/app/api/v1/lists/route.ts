import { fail, ok, readBody } from "@/lib/api-http";
import { apiRoute } from "@/server/api-auth";
import { createList, listsView } from "@/server/campaigns";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/lists — every list, with how many people are on each. */
export const GET = apiRoute("lists:read", async ({ caller }) => {
  const lists = await listsView(caller.orgId);
  return ok({
    data: lists.map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      subscribed: entry.subscribed,
      total: entry.total,
    })),
  });
});

const NewList = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

/** POST /api/v1/lists — make one. */
export const POST = apiRoute("lists:write", async ({ caller, request }) => {
  const body = await readBody(request, NewList);

  try {
    const id = await createList(caller.orgId, body.name, body.description);
    return ok({ id }, 201);
  } catch (error) {
    return fail("invalid_request", error instanceof Error ? error.message : "Bad request");
  }
});
