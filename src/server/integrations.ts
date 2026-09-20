import "server-only";
import { db } from "@/db";
import { integration } from "@/db/schema";
import { checkToken } from "@/lib/cloudflare";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { newId } from "@/lib/utils";
import { and, eq } from "drizzle-orm";

export const CLOUDFLARE = "cloudflare";

export async function getIntegration(userId: string, provider: string) {
  return db.query.integration.findFirst({
    where: and(eq(integration.userId, userId), eq(integration.provider, provider)),
  });
}

/**
 * The Cloudflare token for a user: whatever they connected in Settings, or the
 * server-wide CLOUDFLARE_API_TOKEN if one is configured.
 */
export async function cloudflareToken(userId: string) {
  const row = await getIntegration(userId, CLOUDFLARE);
  if (row) {
    try {
      return decryptSecret(row.secret);
    } catch {
      // Secret was encrypted under a different BETTER_AUTH_SECRET.
      return env.cloudflare.apiToken || null;
    }
  }
  return env.cloudflare.apiToken || null;
}

export async function cloudflareStatus(userId: string) {
  const row = await getIntegration(userId, CLOUDFLARE);
  if (row) {
    return {
      connected: true as const,
      source: "settings" as const,
      hint: row.hint,
      label: row.label,
      verifiedAt: row.verifiedAt,
    };
  }
  if (env.cloudflare.apiToken) {
    return {
      connected: true as const,
      source: "env" as const,
      hint: `…${env.cloudflare.apiToken.slice(-4)}`,
      label: null,
      verifiedAt: null,
    };
  }
  return { connected: false as const };
}

/** Verifies the token against Cloudflare before storing it encrypted. */
export async function connectCloudflare(userId: string, token: string) {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Paste a token first");

  const check = await checkToken(trimmed);
  if (!check.ok) throw new Error(check.error ?? "Cloudflare rejected that token");
  if (check.zones.length === 0) {
    throw new Error("That token works but can see no zones. Give it Zone:Read on your zones.");
  }

  const existing = await getIntegration(userId, CLOUDFLARE);
  const values = {
    secret: encryptSecret(trimmed),
    hint: `…${trimmed.slice(-4)}`,
    label: `${check.zones.length} zone${check.zones.length === 1 ? "" : "s"}`,
    verifiedAt: new Date(),
  };

  if (existing) {
    await db.update(integration).set(values).where(eq(integration.id, existing.id));
  } else {
    await db.insert(integration).values({
      id: newId("int"),
      userId,
      provider: CLOUDFLARE,
      ...values,
    });
  }

  return { zones: check.zones };
}

export async function disconnectCloudflare(userId: string) {
  await db
    .delete(integration)
    .where(and(eq(integration.userId, userId), eq(integration.provider, CLOUDFLARE)));
}
