import "server-only";
import { db } from "@/db";
import { integration } from "@/db/schema";
import { listZones, verifyToken } from "@/lib/cloudflare";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { newId } from "@/lib/utils";
import { and, eq } from "drizzle-orm";

export const CLOUDFLARE = "cloudflare";

export async function getIntegration(orgId: string, provider: string) {
  return db.query.integration.findFirst({
    where: and(eq(integration.organizationId, orgId), eq(integration.provider, provider)),
  });
}

/** The decrypted token plus the account it belongs to, or null when not connected. */
export async function cloudflareCredentials(orgId: string) {
  const row = await getIntegration(orgId, CLOUDFLARE);
  if (!row?.accountId) return null;
  try {
    return { token: decryptSecret(row.secret), accountId: row.accountId };
  } catch {
    // Encrypted under a different BETTER_AUTH_SECRET; treat as not connected.
    return null;
  }
}

export async function cloudflareStatus(orgId: string) {
  const row = await getIntegration(orgId, CLOUDFLARE);
  if (!row) return { connected: false as const };
  return {
    connected: true as const,
    hint: row.hint,
    label: row.label,
    accountId: row.accountId,
    verifiedAt: row.verifiedAt,
  };
}

/** Verifies the token and records which account and zones it can reach. */
export async function connectCloudflare(orgId: string, token: string) {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Paste a token first");

  await verifyToken(trimmed);

  const zones = await listZones(trimmed);
  if (zones.length === 0) {
    throw new Error("That token works but can see no zones. Give it Zone:Read on your zones.");
  }

  const accountId = zones[0]?.account?.id;
  if (!accountId) throw new Error("Could not determine the Cloudflare account from that token");

  const existing = await getIntegration(orgId, CLOUDFLARE);
  const values = {
    secret: encryptSecret(trimmed),
    hint: `…${trimmed.slice(-4)}`,
    label: `${zones.length} zone${zones.length === 1 ? "" : "s"}`,
    accountId,
    verifiedAt: new Date(),
  };

  if (existing) {
    await db.update(integration).set(values).where(eq(integration.id, existing.id));
  } else {
    await db
      .insert(integration)
      .values({ id: newId("int"), organizationId: orgId, provider: CLOUDFLARE, ...values });
  }

  return { zones: zones.map((zone) => zone.name), accountId };
}

export async function disconnectCloudflare(orgId: string) {
  await db
    .delete(integration)
    .where(and(eq(integration.organizationId, orgId), eq(integration.provider, CLOUDFLARE)));
}
