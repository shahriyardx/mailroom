import "server-only";
import { db } from "@/db";
import { apiKey } from "@/db/schema";
import { bearerToken, hashApiKey } from "@/lib/api-key";
import { and, eq, isNull } from "drizzle-orm";

export interface ApiCaller {
  keyId: string;
  userId: string;
  /** When set, the key may only send from this one mailbox. */
  mailboxId: string | null;
}

/** Looks up a bearer key by hash. Revoked keys are treated as missing. */
export async function authenticateApiKey(request: Request): Promise<ApiCaller | null> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return null;

  const row = await db.query.apiKey.findFirst({
    where: and(eq(apiKey.hash, hashApiKey(token)), isNull(apiKey.revokedAt)),
  });
  if (!row) return null;

  await db.update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, row.id));

  return { keyId: row.id, userId: row.userId, mailboxId: row.mailboxId };
}
