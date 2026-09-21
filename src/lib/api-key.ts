import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Live and test keys are told apart by sight, not by a flag somewhere.
 *
 * A test key that reached production config would otherwise look exactly like
 * the real one, and the failure — mail that silently never arrives — is the
 * kind nobody notices for a week.
 */
const PREFIXES = { live: "mk_live_", test: "mk_test_" } as const;

export type KeyMode = keyof typeof PREFIXES;

export function isKeyMode(value: string): value is KeyMode {
  return value === "live" || value === "test";
}

export interface GeneratedKey {
  /** Shown to the user once, never stored. */
  token: string;
  hash: string;
  prefix: string;
}

export function generateApiKey(mode: KeyMode = "live"): GeneratedKey {
  const secret = randomBytes(24).toString("base64url");
  const start = PREFIXES[mode];
  const token = `${start}${secret}`;
  return {
    token,
    hash: hashApiKey(token),
    prefix: `${start}${secret.slice(0, 4)}…${secret.slice(-4)}`,
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
