import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX = "mk_live_";

export interface GeneratedKey {
  /** Shown to the user once, never stored. */
  token: string;
  hash: string;
  prefix: string;
}

export function generateApiKey(): GeneratedKey {
  const secret = randomBytes(24).toString("base64url");
  const token = `${PREFIX}${secret}`;
  return {
    token,
    hash: hashApiKey(token),
    prefix: `${PREFIX}${secret.slice(0, 4)}…${secret.slice(-4)}`,
  };
}

export function hashApiKey(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Pulls the bearer token out of an Authorization header. */
export function bearerToken(header: string | null) {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
}

export function sameHash(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
