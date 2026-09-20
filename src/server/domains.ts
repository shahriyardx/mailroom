import "server-only";
import { resolveTxt } from "node:dns/promises";
import { db } from "@/db";
import { domain, type DomainStatus, mailbox } from "@/db/schema";
import { generateDkimKeyPair, normalizeSelector } from "@/lib/dkim";
import { env } from "@/lib/env";
import {
  createDomainIdentity,
  deleteIdentity,
  dnsRecordsFor,
  getIdentity,
  listIdentities,
  putExternalDkim,
  setMailFromDomain,
  toDomainStatus,
} from "@/lib/ses";
import { newId } from "@/lib/utils";
import { and, asc, eq, sql } from "drizzle-orm";

/** How long an SES status is trusted before the settings page refreshes it. */
const STALE_AFTER_MS = 10 * 60 * 1000;

export async function listDomainsForUser(userId: string) {
  return db.query.domain.findMany({
    where: eq(domain.userId, userId),
    orderBy: [asc(domain.name)],
  });
}

export function recordsForDomain(row: {
  name: string;
  region: string;
  dkimTokens: string[];
  dkimOrigin?: string | null;
  dkimPublicKey?: string | null;
  mailFromDomain: string | null;
  inheritedFrom?: string | null;
}) {
  // A subdomain covered by its parent has no identity, so no records.
  if (row.inheritedFrom) return [];

  return dnsRecordsFor({
    domain: row.name,
    region: row.region,
    dkimTokens: row.dkimTokens,
    dkimOrigin: row.dkimOrigin,
    dkimPublicKey: row.dkimPublicKey,
    mailFromDomain: row.mailFromDomain,
  });
}

/**
 * Moves a domain onto a DKIM key we generate, which is what a single TXT
 * record requires. The private key is uploaded to SES and then dropped; only
 * the public half is stored, since that is all the DNS record needs.
 */
export async function useOwnDkimKey(userId: string, domainId: string) {
  const row = await db.query.domain.findFirst({
    where: and(eq(domain.id, domainId), eq(domain.userId, userId)),
  });
  if (!row) throw new Error("Unknown domain");

  const selector = normalizeSelector(env.aws.dkimSelector);
  const keys = generateDkimKeyPair();

  const result = await putExternalDkim({
    domain: row.name,
    selector,
    privateKey: keys.privateKey,
  });

  await db
    .update(domain)
    .set({
      dkimOrigin: "EXTERNAL",
      dkimStatus: toDomainStatus(result.dkimStatus) as DomainStatus,
      dkimTokens: result.dkimTokens.length ? result.dkimTokens : [selector],
      dkimPublicKey: keys.publicKey,
      lastCheckedAt: new Date(),
    })
    .where(eq(domain.id, row.id));

  return { selector };
}

/**
 * Pulls every domain identity out of SES and upserts it locally.
 * Safe to run repeatedly: existing rows are refreshed, not duplicated.
 */
export async function importFromSes(userId: string) {
  const identities = await listIdentities();
  const domains = identities.filter((item) => item.type === "DOMAIN");

  let imported = 0;
  let updated = 0;

  for (const item of domains) {
    const detail = await getIdentity(item.name);
    if (!detail) continue;

    const existing = await db.query.domain.findFirst({
      where: and(eq(domain.userId, userId), eq(domain.name, item.name)),
    });

    const values = {
      status: toDomainStatus(detail.verificationStatus) as DomainStatus,
      sendingEnabled: detail.sendingEnabled,
      dkimStatus: toDomainStatus(detail.dkimStatus) as DomainStatus,
      dkimOrigin: detail.dkimOrigin,
      dkimTokens: detail.dkimTokens,
      mailFromDomain: detail.mailFromDomain,
      mailFromStatus: detail.mailFromStatus
        ? (toDomainStatus(detail.mailFromStatus) as DomainStatus)
        : null,
      region: env.aws.region,
      lastCheckedAt: new Date(),
    };

    if (existing) {
      await db.update(domain).set(values).where(eq(domain.id, existing.id));
      updated += 1;
    } else {
      await db.insert(domain).values({
        id: newId("dom"),
        userId,
        name: item.name,
        importedAt: new Date(),
        ...values,
      });
      imported += 1;
    }
  }

  await linkOrphanMailboxes(userId);
  return { imported, updated, total: domains.length };
}

/** Runs an import when nothing has been fetched yet, or the data has gone stale. */
export async function ensureDomainsSynced(userId: string) {
  const rows = await listDomainsForUser(userId);

  const stale =
    rows.length === 0 ||
    rows.some(
      (row) => !row.lastCheckedAt || Date.now() - row.lastCheckedAt.getTime() > STALE_AFTER_MS,
    );

  if (!stale) return { ok: true as const, synced: false as const, rows };

  try {
    await importFromSes(userId);
    return { ok: true as const, synced: true as const, rows: await listDomainsForUser(userId) };
  } catch (error) {
    // SES being unreachable must not take the settings page down.
    return {
      ok: false as const,
      synced: false as const,
      rows,
      error: error instanceof Error ? error.message : "Could not reach SES",
    };
  }
}

/** Creates the identity in SES, turns on Easy DKIM and a custom MAIL FROM. */
export async function addDomain(userId: string, rawName: string) {
  const name = rawName
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(name)) {
    throw new Error("That does not look like a domain name");
  }

  const existing = await db.query.domain.findFirst({
    where: and(eq(domain.userId, userId), eq(domain.name, name)),
  });
  if (existing) throw new Error("That domain is already here");

  // SES inherits a domain's verification down its subdomains, so a subdomain
  // of something already verified needs no identity and no DNS at all. Record
  // it as covered by the parent and stop.
  const owned = await db.query.domain.findMany({ where: eq(domain.userId, userId) });
  const parent = owned
    .filter(
      (row) =>
        row.status === "verified" &&
        row.sendingEnabled &&
        !row.inheritedFrom &&
        name.endsWith(`.${row.name}`),
    )
    // The longest match is the closest parent.
    .sort((a, b) => b.name.length - a.name.length)[0];

  if (parent) {
    const id = newId("dom");
    await db.insert(domain).values({
      id,
      userId,
      name,
      region: parent.region,
      status: "verified",
      sendingEnabled: true,
      dkimStatus: "verified",
      inheritedFrom: parent.name,
      lastCheckedAt: new Date(),
    });
    return { id, name, inheritedFrom: parent.name };
  }

  // Reuse the identity if SES already knows it, rather than failing.
  const known = await getIdentity(name);
  if (!known) await createDomainIdentity(name);

  // New domains get a key we generate, so verification is one TXT record
  // rather than three CNAMEs. An identity that already has an external key
  // keeps it, since its record is already published.
  const selector = normalizeSelector(env.aws.dkimSelector);
  let dkimTokens = known?.dkimTokens ?? [];
  let dkimStatus = known?.dkimStatus ?? "PENDING";
  let dkimOrigin = known?.dkimOrigin ?? null;
  let dkimPublicKey: string | null = null;

  if (dkimOrigin !== "EXTERNAL") {
    const keys = generateDkimKeyPair();
    const applied = await putExternalDkim({ domain: name, selector, privateKey: keys.privateKey });
    dkimTokens = applied.dkimTokens.length ? applied.dkimTokens : [selector];
    dkimStatus = applied.dkimStatus;
    dkimOrigin = "EXTERNAL";
    dkimPublicKey = keys.publicKey;
  }

  const mailFrom = `${env.aws.mailFromPrefix}.${name}`;
  let mailFromSet = true;
  try {
    await setMailFromDomain(name, mailFrom);
  } catch {
    // Not fatal: SES falls back to amazonses.com as the return path.
    mailFromSet = false;
  }

  const id = newId("dom");
  await db.insert(domain).values({
    id,
    userId,
    name,
    region: env.aws.region,
    status: toDomainStatus(known?.verificationStatus) as DomainStatus,
    sendingEnabled: known?.sendingEnabled ?? false,
    dkimStatus: toDomainStatus(dkimStatus) as DomainStatus,
    dkimOrigin,
    dkimTokens,
    dkimPublicKey,
    mailFromDomain: mailFromSet ? mailFrom : null,
    mailFromStatus: mailFromSet ? "pending" : null,
    importedAt: known ? new Date() : null,
    lastCheckedAt: new Date(),
  });

  return { id, name };
}

export async function refreshDomain(userId: string, domainId: string) {
  const row = await db.query.domain.findFirst({
    where: and(eq(domain.id, domainId), eq(domain.userId, userId)),
  });
  if (!row) throw new Error("Unknown domain");
  // There is no identity to ask about; it stands or falls with its parent.
  if (row.inheritedFrom) return row;

  const detail = await getIdentity(row.name);
  if (!detail) {
    await db
      .update(domain)
      .set({ status: "failed", sendingEnabled: false, lastCheckedAt: new Date() })
      .where(eq(domain.id, row.id));
    return { status: "failed" as const };
  }

  const dns = await probeDns(row.name);

  await db
    .update(domain)
    .set({
      status: toDomainStatus(detail.verificationStatus) as DomainStatus,
      sendingEnabled: detail.sendingEnabled,
      dkimStatus: toDomainStatus(detail.dkimStatus) as DomainStatus,
      dkimOrigin: detail.dkimOrigin,
      dkimTokens: detail.dkimTokens.length ? detail.dkimTokens : row.dkimTokens,
      mailFromDomain: detail.mailFromDomain,
      mailFromStatus: detail.mailFromStatus
        ? (toDomainStatus(detail.mailFromStatus) as DomainStatus)
        : null,
      spfVerified: dns.spf,
      dmarcVerified: dns.dmarc,
      lastCheckedAt: new Date(),
    })
    .where(eq(domain.id, row.id));

  await linkOrphanMailboxes(userId);
  return { status: toDomainStatus(detail.verificationStatus) };
}

export async function removeDomain(userId: string, domainId: string, alsoDeleteInSes: boolean) {
  const row = await db.query.domain.findFirst({
    where: and(eq(domain.id, domainId), eq(domain.userId, userId)),
  });
  if (!row) return;

  // An inherited subdomain has no identity of its own; deleting the parent's
  // would take every other subdomain down with it.
  if (alsoDeleteInSes && !row.inheritedFrom) {
    try {
      await deleteIdentity(row.name);
    } catch {
      // Already gone in SES, or not permitted; the local row still goes.
    }
  }

  await db.delete(domain).where(eq(domain.id, row.id));
}

/** Checks whether the SPF and DMARC TXT records actually resolve. */
export async function probeDns(name: string) {
  const [spf, dmarc] = await Promise.all([
    resolveTxt(name)
      .then((records) => records.flat().join(" ").includes("include:amazonses.com"))
      .catch(() => false),
    resolveTxt(`_dmarc.${name}`)
      .then((records) => records.flat().join(" ").toLowerCase().includes("v=dmarc1"))
      .catch(() => false),
  ]);
  return { spf, dmarc };
}

/** Points mailboxes at their domain row once that row exists. */
async function linkOrphanMailboxes(userId: string) {
  await db
    .update(mailbox)
    .set({
      domainId: sql`(select d.id from ${domain} d where d.user_id = ${userId} and d.name = ${mailbox.domain} limit 1)`,
    })
    .where(and(eq(mailbox.userId, userId), sql`${mailbox.domainId} is null`));
}

/** A domain is usable for sending only when SES says so. */
export function isSendable(row: { status: string; sendingEnabled: boolean }) {
  return row.sendingEnabled && row.status === "verified";
}
