import "server-only";
import { db } from "@/db";
import { domain, mailbox } from "@/db/schema";
import { coveringDomain, domainOf } from "@/lib/mail";
import type { Scope } from "@/lib/scope";
import { colorOf, newId } from "@/lib/utils";
import { and, asc, eq } from "drizzle-orm";

export async function listMailboxes(orgId: string) {
  return db.query.mailbox.findMany({
    where: eq(mailbox.organizationId, orgId),
    orderBy: [asc(mailbox.domain), asc(mailbox.address)],
  });
}

export interface DomainGroup {
  domain: string;
  mailboxes: Awaited<ReturnType<typeof listMailboxes>>;
}

export function groupByDomain(boxes: Awaited<ReturnType<typeof listMailboxes>>): DomainGroup[] {
  const map = new Map<string, DomainGroup>();
  for (const box of boxes) {
    const group = map.get(box.domain) ?? { domain: box.domain, mailboxes: [] };
    group.mailboxes.push(box);
    map.set(box.domain, group);
  }
  return [...map.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

/** Turns a UI scope into the concrete mailbox ids the query may touch. */
export async function resolveScope(orgId: string, scope: Scope) {
  const boxes = await listMailboxes(orgId);
  if (scope.kind === "all") return boxes.map((box) => box.id);
  if (scope.kind === "domain") {
    return boxes.filter((box) => box.domain === scope.domain).map((box) => box.id);
  }
  return boxes.filter((box) => box.id === scope.mailboxId).map((box) => box.id);
}

export async function getMailboxForUser(orgId: string, mailboxId: string) {
  return db.query.mailbox.findFirst({
    where: and(eq(mailbox.id, mailboxId), eq(mailbox.organizationId, orgId)),
  });
}

export async function getDefaultMailbox(orgId: string) {
  const boxes = await listMailboxes(orgId);
  return boxes.find((box) => box.isDefault) ?? boxes[0];
}

/**
 * The mailbox an address sends from, creating it when the address sits on a
 * domain this account has verified. SES already allows any address on a
 * verified domain, so refusing one that simply has no row here would be our
 * own restriction rather than a real one — and code sends from addresses like
 * noreply@ and receipts@ that nobody would think to create by hand.
 *
 * Returns null when the address is not covered, which the caller reports.
 */
export async function mailboxForSending(orgId: string, address: string) {
  const normalized = address.toLowerCase();

  const existing = await db.query.mailbox.findFirst({
    where: and(eq(mailbox.address, normalized), eq(mailbox.organizationId, orgId)),
  });
  if (existing) return existing;

  const owned = await db.query.domain.findMany({ where: eq(domain.organizationId, orgId) });
  const covering = coveringDomain(normalized, owned);
  if (!covering || !(covering.status === "verified" && covering.sendingEnabled)) return null;

  const local = normalized.split("@")[0] ?? normalized;
  const id = newId("mbx");

  await db
    .insert(mailbox)
    .values({
      id,
      organizationId: orgId,
      address: normalized,
      domain: domainOf(normalized),
      domainId: covering.id,
      displayName: local,
      color: colorOf(normalized),
    })
    // Two sends from a new address can land at the same moment.
    .onConflictDoNothing();

  return (
    (await db.query.mailbox.findFirst({
      where: and(eq(mailbox.address, normalized), eq(mailbox.organizationId, orgId)),
    })) ?? null
  );
}
