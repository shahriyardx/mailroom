import "server-only";
import { db } from "@/db";
import { mailbox } from "@/db/schema";
import type { Scope } from "@/lib/scope";
import { and, asc, eq } from "drizzle-orm";

export async function listMailboxes(userId: string) {
  return db.query.mailbox.findMany({
    where: eq(mailbox.userId, userId),
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
export async function resolveScope(userId: string, scope: Scope) {
  const boxes = await listMailboxes(userId);
  if (scope.kind === "all") return boxes.map((box) => box.id);
  if (scope.kind === "domain") {
    return boxes.filter((box) => box.domain === scope.domain).map((box) => box.id);
  }
  return boxes.filter((box) => box.id === scope.mailboxId).map((box) => box.id);
}

export async function getMailboxForUser(userId: string, mailboxId: string) {
  return db.query.mailbox.findFirst({
    where: and(eq(mailbox.id, mailboxId), eq(mailbox.userId, userId)),
  });
}

export async function getDefaultMailbox(userId: string) {
  const boxes = await listMailboxes(userId);
  return boxes.find((box) => box.isDefault) ?? boxes[0];
}
