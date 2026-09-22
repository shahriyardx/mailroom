import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { broadcast, broadcastRecipient, listMember, mailbox, mailingList } from "@/db/schema";
import { env } from "@/lib/env";
import { newId } from "@/lib/utils";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

/**
 * Lists, and the broadcasts sent to them.
 *
 * Two rules run through all of this and neither is negotiable.
 *
 * Nobody is written to without a record of why. A list member carries where
 * their consent came from and when, because somebody will eventually ask, and
 * "we do not record that" is both a bad answer and the wrong one under GDPR.
 *
 * Every broadcast can be unsubscribed from in one click. Gmail and Yahoo
 * block bulk senders without `List-Unsubscribe`, so this is not a courtesy —
 * it is the difference between delivered and refused.
 */

/* -------------------------------------------------------------------------- */
/* Unsubscribing                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The link in the footer, and the one-click header.
 *
 * Signed rather than stored: a random token per recipient per broadcast would
 * be a row for every copy of every send, and there is nothing here worth the
 * write. The signature covers the member id alone, so the same link keeps
 * working across broadcasts — which is what somebody expects from an old
 * email they dig out a year later.
 */
export function unsubscribeToken(memberId: string) {
  const mac = createHmac("sha256", env.authSecret).update(memberId).digest("base64url");
  return `${memberId}.${mac}`;
}

export function readUnsubscribeToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const memberId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(
    createHmac("sha256", env.authSecret).update(memberId).digest("base64url"),
  );

  // Lengths differ on a malformed token, and timingSafeEqual throws on that.
  if (given.length !== want.length) return null;
  return timingSafeEqual(given, want) ? memberId : null;
}

export function unsubscribeUrl(memberId: string) {
  return `${env.appUrl}/unsubscribe/${unsubscribeToken(memberId)}`;
}

/**
 * Takes somebody off one list.
 *
 * Deliberately not an account-wide block: leaving the newsletter must not stop
 * the release notes they also asked for. Already-unsubscribed is not an error,
 * because a second click on the same link has to look like it worked.
 */
export async function unsubscribeByToken(token: string) {
  const memberId = readUnsubscribeToken(token);
  if (!memberId) return null;

  const row = await db.query.listMember.findFirst({ where: eq(listMember.id, memberId) });
  if (!row) return null;

  if (row.status === "subscribed") {
    await db
      .update(listMember)
      .set({ status: "unsubscribed", unsubscribedAt: new Date() })
      .where(eq(listMember.id, memberId));
  }

  const list = await db.query.mailingList.findFirst({
    where: eq(mailingList.id, row.listId),
    columns: { name: true },
  });

  return { address: row.address, listName: list?.name ?? "this list" };
}

/* -------------------------------------------------------------------------- */
/* Lists                                                                      */
/* -------------------------------------------------------------------------- */

export async function createList(orgId: string, name: string, description?: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the list a name");

  const id = newId("lst");
  await db.insert(mailingList).values({
    id,
    organizationId: orgId,
    name: trimmed,
    description: description?.trim() || null,
  });
  return id;
}

export async function removeList(orgId: string, listId: string) {
  await db
    .delete(mailingList)
    .where(and(eq(mailingList.id, listId), eq(mailingList.organizationId, orgId)));
}

export interface ListRow {
  id: string;
  name: string;
  description: string | null;
  subscribed: number;
  total: number;
}

export async function listsView(orgId: string): Promise<ListRow[]> {
  const lists = await db.query.mailingList.findMany({
    where: eq(mailingList.organizationId, orgId),
    orderBy: (row, { asc: ascending }) => [ascending(row.name)],
  });
  if (lists.length === 0) return [];

  const ids = lists.map((row) => row.id);
  const counts = await db
    .select({
      listId: listMember.listId,
      status: listMember.status,
      howMany: count(),
    })
    .from(listMember)
    .where(inArray(listMember.listId, ids))
    .groupBy(listMember.listId, listMember.status);

  return lists.map((row) => {
    const mine = counts.filter((entry) => entry.listId === row.id);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      subscribed: mine.find((entry) => entry.status === "subscribed")?.howMany ?? 0,
      total: mine.reduce((sum, entry) => sum + entry.howMany, 0),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MemberInput {
  address: string;
  name?: string | null;
  fields?: Record<string, string>;
}

/**
 * Puts people on a list.
 *
 * One call for one address and for ten thousand, because the import path and
 * the add-by-hand path must not drift: the rule about recording consent is
 * worth having in exactly one place.
 *
 * An address already on the list is left alone rather than reset. Re-importing
 * a file must not quietly resubscribe somebody who unsubscribed since the last
 * import — that is the single most common way a sender ends up in a spam
 * folder, and it is always an accident.
 */
export async function addMembers(
  orgId: string,
  listId: string,
  people: MemberInput[],
  consentSource: string,
) {
  const list = await db.query.mailingList.findFirst({
    where: and(eq(mailingList.id, listId), eq(mailingList.organizationId, orgId)),
    columns: { id: true },
  });
  if (!list) throw new Error("No such list");

  const seen = new Set<string>();
  const clean: MemberInput[] = [];
  let rejected = 0;

  for (const person of people) {
    const address = person.address.trim().toLowerCase();
    if (!EMAIL.test(address)) {
      rejected += 1;
      continue;
    }
    // A file with the same address twice would otherwise fail the whole insert.
    if (seen.has(address)) continue;
    seen.add(address);
    clean.push({ address, name: person.name?.trim() || null, fields: person.fields ?? {} });
  }

  if (clean.length === 0) return { added: 0, skipped: 0, rejected };

  const before = await db
    .select({ address: listMember.address })
    .from(listMember)
    .where(and(eq(listMember.listId, listId), inArray(listMember.address, [...seen])));
  const known = new Set(before.map((row) => row.address));

  const fresh = clean.filter((person) => !known.has(person.address));
  if (fresh.length > 0) {
    const now = new Date();
    await db
      .insert(listMember)
      .values(
        fresh.map((person) => ({
          id: newId("lsm"),
          organizationId: orgId,
          listId,
          address: person.address,
          name: person.name ?? null,
          fields: person.fields ?? {},
          consentSource,
          consentAt: now,
        })),
      )
      .onConflictDoNothing();
  }

  return { added: fresh.length, skipped: clean.length - fresh.length, rejected };
}

/**
 * One address per line, optionally `address, name`.
 *
 * Not a full CSV parser on purpose: quoted fields with commas in them are a
 * problem worth having a library for, and this handles the shape people
 * actually paste.
 */
export function parseMemberList(text: string): MemberInput[] {
  return text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [address, ...rest] = line.split(",");
      return { address: address ?? "", name: rest.join(",").trim() || null };
    });
}

export async function setMemberStatus(
  orgId: string,
  memberId: string,
  status: "subscribed" | "unsubscribed",
) {
  await db
    .update(listMember)
    .set({
      status,
      unsubscribedAt: status === "unsubscribed" ? new Date() : null,
      ...(status === "subscribed" ? { consentAt: new Date(), consentSource: "added by hand" } : {}),
    })
    .where(and(eq(listMember.id, memberId), eq(listMember.organizationId, orgId)));
}

export async function removeMember(orgId: string, memberId: string) {
  await db
    .delete(listMember)
    .where(and(eq(listMember.id, memberId), eq(listMember.organizationId, orgId)));
}

export interface MemberRow {
  id: string;
  address: string;
  name: string | null;
  status: "subscribed" | "unsubscribed" | "bounced" | "complained";
  consentSource: string | null;
  consentAt: Date | null;
}

export async function membersView(orgId: string, listId: string, limit = 200) {
  const rows = await db.query.listMember.findMany({
    where: and(eq(listMember.organizationId, orgId), eq(listMember.listId, listId)),
    orderBy: (row, { asc: ascending }) => [ascending(row.address)],
    limit,
  });

  return rows.map(
    (row): MemberRow => ({
      id: row.id,
      address: row.address,
      name: row.name,
      status: row.status,
      consentSource: row.consentSource,
      consentAt: row.consentAt,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Broadcasts                                                                 */
/* -------------------------------------------------------------------------- */

export async function createBroadcast(
  orgId: string,
  input: { listId: string; mailboxId: string; subject: string; html?: string; text?: string },
) {
  const subject = input.subject.trim();
  if (!subject) throw new Error("Give the broadcast a subject");

  const [list, box] = await Promise.all([
    db.query.mailingList.findFirst({
      where: and(eq(mailingList.id, input.listId), eq(mailingList.organizationId, orgId)),
      columns: { id: true },
    }),
    db.query.mailbox.findFirst({
      where: and(eq(mailbox.id, input.mailboxId), eq(mailbox.organizationId, orgId)),
      columns: { id: true },
    }),
  ]);
  if (!list) throw new Error("No such list");
  if (!box) throw new Error("No such mailbox");

  const id = newId("bct");
  await db.insert(broadcast).values({
    id,
    organizationId: orgId,
    listId: input.listId,
    mailboxId: input.mailboxId,
    subject,
    html: input.html ?? null,
    text: input.text ?? null,
  });
  return id;
}

/**
 * Freezes who this goes to, and lets it start.
 *
 * The recipient rows are written now rather than read as the send runs. A
 * broadcast that consulted the list as it went would send to somebody who
 * subscribed halfway through and skip somebody who left, and neither is
 * explicable to the person it happened to. It also makes a send that dies
 * halfway resumable: whatever is still "pending" is exactly what is left.
 */
export async function startBroadcast(orgId: string, broadcastId: string, when?: Date | null) {
  const row = await db.query.broadcast.findFirst({
    where: and(eq(broadcast.id, broadcastId), eq(broadcast.organizationId, orgId)),
  });
  if (!row) throw new Error("No such broadcast");
  if (row.status !== "draft") throw new Error("That broadcast has already been started");

  const audience = await db.query.listMember.findMany({
    where: and(eq(listMember.listId, row.listId), eq(listMember.status, "subscribed")),
    columns: { id: true, address: true },
  });
  if (audience.length === 0) throw new Error("Nobody on that list is subscribed");

  await db
    .insert(broadcastRecipient)
    .values(
      audience.map((person) => ({
        id: newId("bcr"),
        organizationId: orgId,
        broadcastId,
        listMemberId: person.id,
        address: person.address,
      })),
    )
    .onConflictDoNothing();

  const scheduled = when && when.getTime() > Date.now();
  await db
    .update(broadcast)
    .set({
      status: scheduled ? "scheduled" : "sending",
      scheduledAt: scheduled ? when : null,
      startedAt: scheduled ? null : new Date(),
    })
    .where(eq(broadcast.id, broadcastId));

  return { recipients: audience.length, scheduled: Boolean(scheduled) };
}

export async function cancelBroadcast(orgId: string, broadcastId: string) {
  await db
    .update(broadcast)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(
      and(
        eq(broadcast.id, broadcastId),
        eq(broadcast.organizationId, orgId),
        inArray(broadcast.status, ["draft", "scheduled", "sending"]),
      ),
    );
}

export interface BroadcastRow {
  id: string;
  subject: string;
  listId: string;
  listName: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  scheduledAt: Date | null;
  createdAt: Date;
  total: number;
  sent: number;
  failed: number;
  opened: number;
}

export async function broadcastsView(orgId: string): Promise<BroadcastRow[]> {
  const rows = await db
    .select({
      id: broadcast.id,
      subject: broadcast.subject,
      listId: broadcast.listId,
      listName: mailingList.name,
      status: broadcast.status,
      scheduledAt: broadcast.scheduledAt,
      createdAt: broadcast.createdAt,
    })
    .from(broadcast)
    .innerJoin(mailingList, eq(mailingList.id, broadcast.listId))
    .where(eq(broadcast.organizationId, orgId))
    .orderBy(desc(broadcast.createdAt));

  if (rows.length === 0) return [];

  const tallies = await db
    .select({
      broadcastId: broadcastRecipient.broadcastId,
      status: broadcastRecipient.status,
      howMany: count(),
      opened: sql<number>`count(${broadcastRecipient.openedAt})`.mapWith(Number),
    })
    .from(broadcastRecipient)
    .where(
      inArray(
        broadcastRecipient.broadcastId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(broadcastRecipient.broadcastId, broadcastRecipient.status);

  return rows.map((row) => {
    const mine = tallies.filter((entry) => entry.broadcastId === row.id);
    return {
      ...row,
      total: mine.reduce((sum, entry) => sum + entry.howMany, 0),
      sent: mine.find((entry) => entry.status === "sent")?.howMany ?? 0,
      failed: mine.find((entry) => entry.status === "failed")?.howMany ?? 0,
      opened: mine.reduce((sum, entry) => sum + entry.opened, 0),
    };
  });
}

/** Mailboxes a broadcast can be sent from, for the composer's picker. */
export async function sendableMailboxes(orgId: string) {
  return db
    .select({ id: mailbox.id, address: mailbox.address })
    .from(mailbox)
    .where(eq(mailbox.organizationId, orgId))
    .orderBy(asc(mailbox.address));
}
