import "server-only";

import { createHash } from "node:crypto";
import { db } from "@/db";
import { idempotencyRecord } from "@/db/schema";
import { fail, ok } from "@/lib/api-http";
import { newId } from "@/lib/utils";
import { and, eq, lt } from "drizzle-orm";

/** How long a key is remembered. Long enough to cover any client's retries. */
const KEEP_HOURS = 24;

export function hashBody(body: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(body ?? null))
    .digest("hex");
}

export interface IdempotencyCheck {
  /** Null when the request is new and should be handled normally. */
  replay: Response | null;
  /** Called with the reply once the request has been handled. */
  remember: (status: number, response: Record<string, unknown>) => Promise<void>;
}

/**
 * Makes a POST safe to retry.
 *
 * A client that sends the same `Idempotency-Key` twice gets the first reply
 * back rather than a second send. The body is hashed too: the same key with
 * different content is a mistake worth reporting, not a repeat to satisfy.
 *
 * When no key is given, everything here is a no-op, so a handler can call it
 * unconditionally.
 */
export async function idempotency(
  request: Request,
  orgId: string,
  endpoint: string,
  body: unknown,
): Promise<IdempotencyCheck> {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) return { replay: null, remember: async () => {} };

  if (key.length > 255) {
    return {
      replay: fail("invalid_request", "Idempotency-Key must be 255 characters or fewer"),
      remember: async () => {},
    };
  }

  const requestHash = hashBody(body);

  const [existing] = await db
    .select()
    .from(idempotencyRecord)
    .where(and(eq(idempotencyRecord.organizationId, orgId), eq(idempotencyRecord.key, key)))
    .limit(1);

  if (existing) {
    if (existing.requestHash !== requestHash || existing.endpoint !== endpoint) {
      return {
        replay: fail("conflict", "This Idempotency-Key was already used for a different request"),
        remember: async () => {},
      };
    }
    return {
      replay: ok(existing.response, existing.statusCode, { "Idempotency-Replayed": "true" }),
      remember: async () => {},
    };
  }

  // Old rows are swept here rather than on a schedule: there is no scheduler,
  // and the only moment this table matters is when it is being read.
  void db
    .delete(idempotencyRecord)
    .where(lt(idempotencyRecord.createdAt, new Date(Date.now() - KEEP_HOURS * 3600_000)))
    .catch(() => {});

  return {
    replay: null,
    remember: async (status, response) => {
      await db
        .insert(idempotencyRecord)
        .values({
          id: newId("idem"),
          organizationId: orgId,
          key,
          requestHash,
          endpoint,
          statusCode: status,
          response,
        })
        // Two identical requests can arrive at once; the first one to land wins.
        .onConflictDoNothing()
        .catch(() => {});
    },
  };
}
