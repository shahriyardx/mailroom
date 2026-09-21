import "server-only";
import { db } from "@/db";
import { apiKey, mailbox, webhook } from "@/db/schema";
import { BodyError, fail, serverError } from "@/lib/api-http";
import { bearerToken, hashApiKey } from "@/lib/api-key";
import { type Scope, expandScopes, hasScope } from "@/lib/api-scopes";
import { and, eq, isNull } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

/** Calls a minute a key may make when it does not set its own limit. */
export const DEFAULT_RATE_LIMIT = 300;

export interface ApiCaller {
  keyId: string;
  keyName: string;
  orgId: string;
  /**
   * What the key may reach. Named addresses, whole domains, or — when both
   * are empty — every mailbox in the account.
   */
  reach: { mailboxIds: string[]; domainIds: string[]; unrestricted: boolean };
  scopes: Set<string>;
  rawScopes: string[];
  rateLimit: number;
}

/** Looks up a bearer key by hash. Revoked keys are treated as missing. */
export async function authenticateApiKey(request: Request): Promise<ApiCaller | null> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return null;

  const row = await db.query.apiKey.findFirst({
    where: and(eq(apiKey.hash, hashApiKey(token)), isNull(apiKey.revokedAt)),
  });
  if (!row) return null;

  // Not awaited: a key's last-used stamp is bookkeeping, and making every
  // call wait for a write to finish it would show up in every latency graph.
  void db
    .update(apiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKey.id, row.id))
    .catch(() => {});

  // A key written before reach was a list still says what it meant in the
  // old column, so it is read as a list of one.
  const mailboxIds =
    row.scopeMailboxIds.length > 0 ? row.scopeMailboxIds : row.mailboxId ? [row.mailboxId] : [];
  const domainIds = row.scopeDomainIds;

  return {
    keyId: row.id,
    keyName: row.name,
    orgId: row.organizationId,
    reach: {
      mailboxIds,
      domainIds,
      unrestricted: mailboxIds.length === 0 && domainIds.length === 0,
    },
    scopes: expandScopes(row.scopes),
    rawScopes: row.scopes,
    rateLimit: row.rateLimit ?? DEFAULT_RATE_LIMIT,
  };
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

interface Window {
  count: number;
  resetAt: number;
}

/**
 * A fixed window per key, held in the process.
 *
 * This is deliberately simple, and it is per container: two of them allow
 * twice the stated rate. It exists to stop a runaway loop from emptying an
 * SES quota, not to meter a paid plan, and a shared counter would mean a
 * round trip to Redis on every call for that.
 */
const globalForLimits = globalThis as unknown as { mailroomApiWindows?: Map<string, Window> };

function windows() {
  if (!globalForLimits.mailroomApiWindows) globalForLimits.mailroomApiWindows = new Map();
  return globalForLimits.mailroomApiWindows;
}

export interface RateResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export function checkRate(keyId: string, limit: number): RateResult {
  const now = Date.now();
  const map = windows();
  let window = map.get(keyId);

  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + 60_000 };
    map.set(keyId, window);

    // Keys that stopped calling would otherwise sit here for the life of the
    // process. Sweeping on a miss costs nothing and keeps the map small.
    if (map.size > 5_000) {
      for (const [id, entry] of map) if (entry.resetAt <= now) map.delete(id);
    }
  }

  window.count += 1;
  const remaining = Math.max(0, limit - window.count);
  return { allowed: window.count <= limit, limit, remaining, resetAt: window.resetAt };
}

function rateHeaders(rate: RateResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(rate.limit),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

/* -------------------------------------------------------------------------- */
/* The wrapper every v1 handler is written inside                             */
/* -------------------------------------------------------------------------- */

export interface RouteContext<P> {
  request: NextRequest;
  caller: ApiCaller;
  url: URL;
  params: P;
}

type Handler<P> = (context: RouteContext<P>) => Promise<Response> | Response;

/**
 * Wraps a handler with the four things every endpoint needs and none of them
 * should repeat: the bearer key, the scope it must hold, the rate window, and
 * turning a thrown {@link BodyError} or an unexpected error into a reply.
 *
 * Pass `null` as the scope for an endpoint any valid key may call.
 */
export function apiRoute<P = Record<string, never>>(scope: Scope | null, handler: Handler<P>) {
  return async (request: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    const caller = await authenticateApiKey(request);
    if (!caller) {
      return fail("unauthorized", "Invalid or missing API key");
    }

    if (scope && !hasScope(caller.scopes, scope)) {
      return fail("forbidden", `This API key does not have the "${scope}" scope`, {
        required_scope: scope,
        scopes: caller.rawScopes,
      });
    }

    const rate = checkRate(caller.keyId, caller.rateLimit);
    if (!rate.allowed) {
      const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
      return NextResponse.json(
        { error: "Too many requests. Slow down.", code: "rate_limited" },
        { status: 429, headers: { ...rateHeaders(rate), "Retry-After": String(retryAfter) } },
      );
    }

    try {
      const params = await context.params;
      const response = await handler({
        request,
        caller,
        url: new URL(request.url),
        params,
      });
      for (const [name, value] of Object.entries(rateHeaders(rate))) {
        response.headers.set(name, value);
      }
      return response;
    } catch (error) {
      const response =
        error instanceof BodyError
          ? error.response
          : serverError(new URL(request.url).pathname, error);
      for (const [name, value] of Object.entries(rateHeaders(rate))) {
        response.headers.set(name, value);
      }
      return response;
    }
  };
}

/* -------------------------------------------------------------------------- */
/* What mail a key may touch                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The mailbox ids a key may read or change.
 *
 * A key that names addresses, or names domains, sees only those — everywhere,
 * not only when sending. Reading somebody's whole inbox with a key meant for
 * one department would make the limit decorative.
 */
export async function callerMailboxIds(caller: ApiCaller): Promise<string[]> {
  const rows = await db
    .select({ id: mailbox.id, domainId: mailbox.domainId, domain: mailbox.domain })
    .from(mailbox)
    .where(eq(mailbox.organizationId, caller.orgId));

  if (caller.reach.unrestricted) return rows.map((row) => row.id);

  const named = new Set(caller.reach.mailboxIds);
  const domains = new Set(caller.reach.domainIds);

  return rows
    .filter((row) => named.has(row.id) || (row.domainId !== null && domains.has(row.domainId)))
    .map((row) => row.id);
}

/**
 * The same list, narrowed by `?mailbox_id=`, `?mailbox=` or `?domain=` when
 * the caller asked for one. A value outside what the key may reach narrows to
 * nothing rather than reporting that the mailbox exists.
 */
export async function scopedMailboxIds(caller: ApiCaller, url: URL): Promise<string[]> {
  const allowed = await callerMailboxIds(caller);
  if (allowed.length === 0) return allowed;

  const wantedId = url.searchParams.get("mailbox_id");
  const wantedAddress = url.searchParams.get("mailbox");
  const wantedDomain = url.searchParams.get("domain");
  if (!wantedId && !wantedAddress && !wantedDomain) return allowed;

  const rows = await db
    .select({ id: mailbox.id, address: mailbox.address, domain: mailbox.domain })
    .from(mailbox)
    .where(eq(mailbox.organizationId, caller.orgId));

  const permitted = new Set(allowed);
  return rows
    .filter((row) => permitted.has(row.id))
    .filter((row) => (wantedId ? row.id === wantedId : true))
    .filter((row) => (wantedAddress ? row.address === wantedAddress.toLowerCase().trim() : true))
    .filter((row) => (wantedDomain ? row.domain === wantedDomain.toLowerCase().trim() : true))
    .map((row) => row.id);
}

/**
 * The webhooks a key may see and change. Null means every one in the account.
 *
 * A webhook with no mailbox of its own hears about every address, so a key
 * that reaches part of the account must not be able to make, read or change
 * one — that would be a way to receive mail the key itself cannot read.
 */
export async function reachableWebhookIds(caller: ApiCaller): Promise<string[] | null> {
  if (caller.reach.unrestricted) return null;

  const allowed = new Set(await callerMailboxIds(caller));
  const rows = await db
    .select({ id: webhook.id, mailboxId: webhook.mailboxId })
    .from(webhook)
    .where(eq(webhook.organizationId, caller.orgId));

  return rows
    .filter((row) => row.mailboxId !== null && allowed.has(row.mailboxId))
    .map((row) => row.id);
}

/**
 * Whether a key may attach a webhook to this mailbox. A restricted key must
 * name one, and it must be a mailbox the key already reaches.
 */
export async function mayWatchMailbox(caller: ApiCaller, mailboxId: string | null | undefined) {
  // Ownership first, and for every caller: an unrestricted key reaches all of
  // its own account, which is not the same as all of everybody's.
  if (mailboxId) {
    const owns = await db.query.mailbox.findFirst({
      where: and(eq(mailbox.id, mailboxId), eq(mailbox.organizationId, caller.orgId)),
      columns: { id: true },
    });
    if (!owns) return { ok: false as const, reason: "No such mailbox" };
  }

  if (caller.reach.unrestricted) return { ok: true as const };
  if (!mailboxId) {
    return {
      ok: false as const,
      reason:
        "This API key reaches only part of the account, so a webhook on it must name a mailbox",
    };
  }
  const allowed = await callerMailboxIds(caller);
  if (!allowed.includes(mailboxId)) {
    return { ok: false as const, reason: "No such mailbox" };
  }
  return { ok: true as const };
}

/** The domains a key may create new addresses on. Null means every one. */
export async function creatableDomainIdsFor(caller: ApiCaller): Promise<string[] | null> {
  if (caller.reach.unrestricted) return null;
  // Naming addresses is a list of exactly those addresses; it does not carry
  // permission to invent more beside them.
  return caller.reach.domainIds;
}
