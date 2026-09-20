import { generateKeyPairSync } from "node:crypto";

export interface DkimKeyPair {
  /** PKCS#8 DER, base64, no PEM header — the format SES expects. */
  privateKey: string;
  /** SPKI DER, base64 — the value published after "p=" in the TXT record. */
  publicKey: string;
}

/**
 * Generates a DKIM signing key for BYODKIM.
 *
 * SES accepts RSA 1024 or 2048. The private half is handed to SES and then
 * dropped; only the public half is kept, since that is all the DNS record and
 * the UI ever need.
 */
export function generateDkimKeyPair(): DkimKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "der" },
    publicKeyEncoding: { type: "spki", format: "der" },
  });

  return {
    privateKey: privateKey.toString("base64"),
    publicKey: publicKey.toString("base64"),
  };
}

/** DKIM selectors are a single DNS label: letters, digits and hyphens. */
export function normalizeSelector(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
  return cleaned || "mail";
}
