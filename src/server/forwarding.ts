import "server-only";
import { db } from "@/db";
import { domain, forwardAddress, forwardRule, mailbox } from "@/db/schema";
import {
  CloudflareError,
  addDestination,
  deleteDestination,
  listDestinations,
} from "@/lib/cloudflare";
import { env } from "@/lib/env";
import { newId } from "@/lib/utils";
import { type SQL, and, eq, isNull, or } from "drizzle-orm";
import { cloudflareCredentials } from "./integrations";

/**
 * Where a copy of inbound mail also goes.
 *
 * The worker used to carry one address, baked into it at deploy time, which
 * meant changing it was a redeploy and there was exactly one answer for the
 * whole instance. The rules live here instead, and the worker is told what to
 * do with each message in the reply to the webhook it already sends — so a
 * change takes effect on the next message rather than on the next deploy.
 *
 * Three widths, narrowest first: one mailbox, one domain, the whole instance.
 * Every rule that matches applies. A domain or a mailbox with `forwardOff`
 * set ignores the wider rules above it, which is how one address stays out of
 * a company-wide archive copy.
 */

/** Addresses Cloudflare will actually accept, for one mailbox. */
export async function targetsForMailbox(orgId: string, mailboxId: string): Promise<string[]> {
  const box = await db.query.mailbox.findFirst({
    where: and(eq(mailbox.id, mailboxId), eq(mailbox.organizationId, orgId)),
    columns: { id: true, domainId: true, forwardOff: true },
  });
  if (!box) return [];

  const owningDomain = box.domainId
    ? await db.query.domain.findFirst({
        where: eq(domain.id, box.domainId),
        columns: { id: true, forwardOff: true },
      })
    : null;

  // Widths this message is allowed to pick up, narrowest outwards. A stop at
  // one level ends the walk: nothing wider than it can reach here.
  const scopes: (SQL | undefined)[] = [eq(forwardRule.mailboxId, box.id)];
  if (!box.forwardOff) {
    if (owningDomain) scopes.push(eq(forwardRule.domainId, owningDomain.id));
    if (!owningDomain?.forwardOff) {
      scopes.push(and(isNull(forwardRule.domainId), isNull(forwardRule.mailboxId)));
    }
  }

  return resolve(orgId, scopes);
}

/**
 * The same question for an address no mailbox claims.
 *
 * The worker asks before rejecting, so mail to a retired address can still
 * reach whoever used to read it. Only the domain and instance widths exist
 * here, because there is no mailbox to have a rule.
 *
 * The domain has to be one this instance knows, since that is the only way to
 * tell which account's rules apply. An address on a domain nobody has added
 * forwards nowhere.
 */
export async function targetsForUnknownAddress(address: string): Promise<string[]> {
  const name = address.split("@")[1]?.toLowerCase();
  if (!name) return [];

  const rows = await db.query.domain.findMany({
    where: eq(domain.name, name),
    columns: { id: true, organizationId: true, forwardOff: true },
  });
  // Two accounts holding the same domain name is a configuration nobody can
  // resolve automatically, so nothing is forwarded rather than the wrong one.
  if (rows.length !== 1) return [];
  const owner = rows[0];

  const scopes: (SQL | undefined)[] = [eq(forwardRule.domainId, owner.id)];
  if (!owner.forwardOff) {
    scopes.push(and(isNull(forwardRule.domainId), isNull(forwardRule.mailboxId)));
  }

  return resolve(owner.organizationId, scopes);
}

/**
 * The rules at these widths, turned into addresses.
 *
 * Unverified addresses are dropped here rather than sent: Cloudflare rejects
 * a forward to one, and a rejected forward fails the whole message, which
 * would turn a half-finished setup into lost mail.
 */
async function resolve(orgId: string, scopes: (SQL | undefined)[]): Promise<string[]> {
  const widths = scopes.filter((entry): entry is SQL => entry !== undefined);
  if (widths.length === 0) return legacy();

  const rows = await db
    .select({ address: forwardAddress.address, verifiedAt: forwardAddress.verifiedAt })
    .from(forwardRule)
    .innerJoin(forwardAddress, eq(forwardAddress.id, forwardRule.addressId))
    .where(and(eq(forwardRule.organizationId, orgId), or(...widths)));

  const found = rows.filter((row) => row.verifiedAt !== null).map((row) => row.address);
  return [...new Set([...found, ...legacy()])];
}

/**
 * `FORWARD_TO` from the environment, still honoured.
 *
 * It was the only way to forward before this page existed, and an instance
 * upgrading should not quietly stop copying mail somewhere it has been
 * copying it for months. It applies everywhere, and a `forwardOff` does not
 * stop it — the file it is set in is not something the dashboard owns.
 */
function legacy(): string[] {
  return env.forwardTo
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Managing the addresses                                                     */
/* -------------------------------------------------------------------------- */

export interface ForwardAddressRow {
  id: string;
  address: string;
  verified: boolean;
  createdAt: Date;
  /** Rules pointing at it, for the "in use by" line and for delete warnings. */
  uses: number;
}

export interface ForwardingView {
  /** False when no Cloudflare token is connected; nothing can be verified. */
  connected: boolean;
  addresses: ForwardAddressRow[];
  instance: { ruleId: string; addressId: string }[];
  domains: {
    id: string;
    name: string;
    forwardOff: boolean;
    rules: { ruleId: string; addressId: string }[];
  }[];
  mailboxes: {
    id: string;
    address: string;
    forwardOff: boolean;
    rules: { ruleId: string; addressId: string }[];
  }[];
  /** Set from the environment, unmanageable from here, shown so it is not a mystery. */
  fromEnvironment: string[];
}

export async function forwardingView(orgId: string): Promise<ForwardingView> {
  const [addresses, rules, domains, mailboxes, credentials] = await Promise.all([
    db.query.forwardAddress.findMany({
      where: eq(forwardAddress.organizationId, orgId),
      orderBy: (row, { asc }) => [asc(row.address)],
    }),
    db.query.forwardRule.findMany({ where: eq(forwardRule.organizationId, orgId) }),
    db.query.domain.findMany({
      where: eq(domain.organizationId, orgId),
      columns: { id: true, name: true, forwardOff: true },
      orderBy: (row, { asc }) => [asc(row.name)],
    }),
    db.query.mailbox.findMany({
      where: eq(mailbox.organizationId, orgId),
      columns: { id: true, address: true, forwardOff: true },
      orderBy: (row, { asc }) => [asc(row.address)],
    }),
    cloudflareCredentials(orgId),
  ]);

  const at = (match: (rule: (typeof rules)[number]) => boolean) =>
    rules.filter(match).map((rule) => ({ ruleId: rule.id, addressId: rule.addressId }));

  return {
    connected: Boolean(credentials),
    addresses: addresses.map((row) => ({
      id: row.id,
      address: row.address,
      verified: row.verifiedAt !== null,
      createdAt: row.createdAt,
      uses: rules.filter((rule) => rule.addressId === row.id).length,
    })),
    instance: at((rule) => !rule.domainId && !rule.mailboxId),
    domains: domains.map((row) => ({
      ...row,
      rules: at((rule) => rule.domainId === row.id),
    })),
    mailboxes: mailboxes.map((row) => ({
      ...row,
      rules: at((rule) => rule.mailboxId === row.id),
    })),
    fromEnvironment: legacy(),
  };
}

function explain(error: unknown) {
  if (error instanceof CloudflareError && error.codes.includes(10000)) {
    return new Error(
      "Cloudflare rejected the token. It needs Email Routing Addresses -> Edit. Edit the token in Cloudflare, then reconnect it on the Inbound worker page.",
    );
  }
  return error instanceof Error ? error : new Error("Cloudflare could not be reached");
}

/**
 * Registers an address with Cloudflare and records it here.
 *
 * Cloudflare sends the verification mail; nothing else can. The address is
 * stored either way, so a half-finished one is visible on the page as
 * "waiting" rather than disappearing.
 */
export async function addForwardingAddress(orgId: string, input: string) {
  const address = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error("That is not an email address");

  const existing = await db.query.forwardAddress.findFirst({
    where: and(eq(forwardAddress.organizationId, orgId), eq(forwardAddress.address, address)),
  });
  if (existing) throw new Error("That address is already on the list");

  /*
   * Never forward back into this instance.
   *
   * Mail forwarded to an address on a domain we receive on arrives at the
   * worker again, which stores it and forwards it again. Cloudflare stops
   * the loop eventually, but not before the mailbox has a pile of copies in
   * it. The domain is checked rather than the mailbox because a catch-all or
   * auto-created mailbox means an address with no row today can have one the
   * moment mail reaches it.
   */
  const ours = await db.query.domain.findFirst({
    where: and(eq(domain.organizationId, orgId), eq(domain.name, address.split("@")[1] ?? "")),
    columns: { name: true },
  });
  if (ours) {
    throw new Error(
      `${ours.name} is a domain this instance receives on. Forwarding there would send the mail straight back in.`,
    );
  }

  const credentials = await cloudflareCredentials(orgId);
  if (!credentials) throw new Error("Connect a Cloudflare token on the Inbound worker page first");

  // Cloudflare may already know it — added by hand, or left over from a row
  // deleted here. Reuse that rather than failing on a duplicate.
  let destination: { id: string; verified: string | null };
  try {
    const known = await listDestinations(credentials.token, credentials.accountId);
    const match = known.find((entry) => entry.email.toLowerCase() === address);
    destination =
      match ?? (await addDestination(credentials.token, credentials.accountId, address));
  } catch (error) {
    throw explain(error);
  }

  const id = newId("fwa");
  await db.insert(forwardAddress).values({
    id,
    organizationId: orgId,
    address,
    destinationId: destination.id,
    verifiedAt: destination.verified ? new Date(destination.verified) : null,
    checkedAt: new Date(),
  });

  return { id, verified: Boolean(destination.verified) };
}

/**
 * Asks Cloudflare what it now thinks of every address on the list.
 *
 * There is no webhook for somebody clicking the link in their mail, so the
 * page asks when it is opened and when the button is pressed.
 */
export async function refreshForwardingAddresses(orgId: string) {
  const credentials = await cloudflareCredentials(orgId);
  if (!credentials) return { checked: 0, verified: 0 };

  const rows = await db.query.forwardAddress.findMany({
    where: eq(forwardAddress.organizationId, orgId),
  });
  if (rows.length === 0) return { checked: 0, verified: 0 };

  let known: Awaited<ReturnType<typeof listDestinations>>;
  try {
    known = await listDestinations(credentials.token, credentials.accountId);
  } catch (error) {
    throw explain(error);
  }

  let verified = 0;
  for (const row of rows) {
    const match = known.find((entry) => entry.email.toLowerCase() === row.address);
    const verifiedAt = match?.verified ? new Date(match.verified) : null;
    if (verifiedAt) verified += 1;

    const changed =
      verifiedAt?.getTime() !== row.verifiedAt?.getTime() || match?.id !== row.destinationId;
    if (!changed) continue;

    await db
      .update(forwardAddress)
      .set({ verifiedAt, destinationId: match?.id ?? null, checkedAt: new Date() })
      .where(eq(forwardAddress.id, row.id));
  }

  return { checked: rows.length, verified };
}

/**
 * Makes Cloudflare send the verification mail again.
 *
 * There is no endpoint for a resend, so the destination is removed and added
 * back, which is what the Cloudflare dashboard does too. Only for an address
 * still waiting: doing it to a verified one would un-verify it.
 */
export async function resendForwardingVerification(orgId: string, addressId: string) {
  const row = await db.query.forwardAddress.findFirst({
    where: and(eq(forwardAddress.id, addressId), eq(forwardAddress.organizationId, orgId)),
  });
  if (!row) throw new Error("No such address");
  if (row.verifiedAt) throw new Error("That address is already verified");

  const credentials = await cloudflareCredentials(orgId);
  if (!credentials) throw new Error("Connect a Cloudflare token first");

  try {
    if (row.destinationId) {
      await deleteDestination(credentials.token, credentials.accountId, row.destinationId);
    }
    const made = await addDestination(credentials.token, credentials.accountId, row.address);
    await db
      .update(forwardAddress)
      .set({ destinationId: made.id, verifiedAt: null, checkedAt: new Date() })
      .where(eq(forwardAddress.id, row.id));
  } catch (error) {
    throw explain(error);
  }
}

/**
 * Drops an address and every rule pointing at it.
 *
 * The Cloudflare destination goes too: leaving it behind would let anyone who
 * later adds the same address here skip the verification mail.
 */
export async function removeForwardingAddress(orgId: string, addressId: string) {
  const row = await db.query.forwardAddress.findFirst({
    where: and(eq(forwardAddress.id, addressId), eq(forwardAddress.organizationId, orgId)),
  });
  if (!row) return;

  const credentials = await cloudflareCredentials(orgId);
  if (credentials && row.destinationId) {
    try {
      await deleteDestination(credentials.token, credentials.accountId, row.destinationId);
    } catch {
      // Already gone on their side, or the token lost the permission. The row
      // still goes; a stale destination forwards nothing on its own.
    }
  }

  await db.delete(forwardAddress).where(eq(forwardAddress.id, row.id));
}

/* -------------------------------------------------------------------------- */
/* Managing the rules                                                         */
/* -------------------------------------------------------------------------- */

export type Width =
  | { kind: "instance" }
  | { kind: "domain"; domainId: string }
  | { kind: "mailbox"; mailboxId: string };

export async function addForwardingRule(orgId: string, addressId: string, width: Width) {
  const address = await db.query.forwardAddress.findFirst({
    where: and(eq(forwardAddress.id, addressId), eq(forwardAddress.organizationId, orgId)),
  });
  if (!address) throw new Error("No such address");

  // Both columns are checked against the account, so a crafted id cannot
  // attach a rule to somebody else's domain.
  if (width.kind === "domain") {
    const owned = await db.query.domain.findFirst({
      where: and(eq(domain.id, width.domainId), eq(domain.organizationId, orgId)),
    });
    if (!owned) throw new Error("No such domain");
  }
  if (width.kind === "mailbox") {
    const owned = await db.query.mailbox.findFirst({
      where: and(eq(mailbox.id, width.mailboxId), eq(mailbox.organizationId, orgId)),
    });
    if (!owned) throw new Error("No such mailbox");
  }

  const domainId = width.kind === "domain" ? width.domainId : null;
  const mailboxId = width.kind === "mailbox" ? width.mailboxId : null;

  const already = await db.query.forwardRule.findFirst({
    where: and(
      eq(forwardRule.organizationId, orgId),
      eq(forwardRule.addressId, addressId),
      domainId ? eq(forwardRule.domainId, domainId) : isNull(forwardRule.domainId),
      mailboxId ? eq(forwardRule.mailboxId, mailboxId) : isNull(forwardRule.mailboxId),
    ),
  });
  if (already) return;

  await db.insert(forwardRule).values({
    id: newId("fwr"),
    organizationId: orgId,
    addressId,
    domainId,
    mailboxId,
  });
}

export async function removeForwardingRule(orgId: string, ruleId: string) {
  await db
    .delete(forwardRule)
    .where(and(eq(forwardRule.id, ruleId), eq(forwardRule.organizationId, orgId)));
}

/** The opt-out: stop wider rules reaching this domain or mailbox. */
export async function setForwardOff(orgId: string, width: Width, off: boolean) {
  if (width.kind === "domain") {
    await db
      .update(domain)
      .set({ forwardOff: off })
      .where(and(eq(domain.id, width.domainId), eq(domain.organizationId, orgId)));
    return;
  }
  if (width.kind === "mailbox") {
    await db
      .update(mailbox)
      .set({ forwardOff: off })
      .where(and(eq(mailbox.id, width.mailboxId), eq(mailbox.organizationId, orgId)));
  }
}
