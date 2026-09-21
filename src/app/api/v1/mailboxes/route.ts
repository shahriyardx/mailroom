import { db } from "@/db";
import { domain as domainTable, mailbox } from "@/db/schema";
import { fail, limitOf, ok, page, readBody } from "@/lib/api-http";
import { coveringDomain, domainOf } from "@/lib/mail";
import { colorOf, newId } from "@/lib/utils";
import { apiRoute, callerMailboxIds, creatableDomainIdsFor } from "@/server/api-auth";
import { serializeMailbox } from "@/server/api-serialize";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/mailboxes — every address this key can reach.
 *
 * A key locked to one mailbox sees only that one, which is the fastest way
 * for a client to discover what it is allowed to do.
 */
export const GET = apiRoute("mailboxes:read", async ({ caller, url }) => {
  const reachable = await callerMailboxIds(caller);
  if (reachable.length === 0) return page([], null);

  const filters = [eq(mailbox.organizationId, caller.orgId), inArray(mailbox.id, reachable)];

  const wantedDomain = url.searchParams.get("domain");
  if (wantedDomain) filters.push(eq(mailbox.domain, wantedDomain.toLowerCase().trim()));

  const rows = await db
    .select()
    .from(mailbox)
    .where(and(...filters))
    .orderBy(asc(mailbox.domain), asc(mailbox.address))
    .limit(limitOf(url, 100));

  return page(rows.map(serializeMailbox), null);
});

const createSchema = z.object({
  address: z.string().email(),
  display_name: z.string().min(1).optional(),
  signature: z.string().optional(),
  is_catch_all: z.boolean().optional(),
  is_default: z.boolean().optional(),
  color: z.string().optional(),
});

/**
 * POST /api/v1/mailboxes — add an address on a domain this account owns.
 *
 * A subdomain of a domain you own needs no identity of its own: SES lets it
 * send on the parent's verification, so anything the covering domain reaches
 * is allowed here.
 */
export const POST = apiRoute("mailboxes:write", async ({ caller, request }) => {
  const input = await readBody(request, createSchema);

  const address = input.address.toLowerCase().trim();
  const name = domainOf(address);

  const owned = await db.query.domain.findMany({
    where: eq(domainTable.organizationId, caller.orgId),
  });
  const covering = coveringDomain(address, owned);
  if (!covering) {
    return fail("invalid_request", `Add ${name} as a domain first, or a domain it sits beneath`);
  }

  // A key holding whole domains may add to them. A key that names addresses
  // holds exactly those, and naming one more is not its to do.
  const creatable = await creatableDomainIdsFor(caller);
  if (creatable !== null && !creatable.includes(covering.id)) {
    return fail("forbidden", `This API key cannot add mailboxes on ${covering.name}`);
  }

  const existing = await db.query.mailbox.findFirst({ where: eq(mailbox.address, address) });
  if (existing) {
    return fail("conflict", `${address} already exists`);
  }

  const id = newId("mbx");
  await db.insert(mailbox).values({
    id,
    organizationId: caller.orgId,
    address,
    domain: name,
    domainId: covering.id,
    displayName: input.display_name ?? (address.split("@")[0] as string),
    signature: input.signature ?? null,
    isCatchAll: input.is_catch_all ?? false,
    isDefault: input.is_default ?? false,
    color: input.color ?? colorOf(address),
  });

  // One default at a time, or the composer has to choose between them.
  if (input.is_default) {
    await db
      .update(mailbox)
      .set({ isDefault: false })
      .where(and(eq(mailbox.organizationId, caller.orgId), sql`${mailbox.id} <> ${id}`));
  }

  const [row] = await db.select().from(mailbox).where(eq(mailbox.id, id));
  return ok(serializeMailbox(row!), 201);
});
