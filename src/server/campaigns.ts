import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import {
  type ListMemberStatus,
  automation,
  automationRun,
  broadcast,
  broadcastClick,
  broadcastRecipient,
  customEvent,
  listMember,
  mailbox,
  mailingList,
  message,
  segment,
  workspace,
} from "@/db/schema";
import { type EmailDesign, designToText, renderDesign } from "@/lib/email-blocks";
import { env } from "@/lib/env";
import { newId } from "@/lib/utils";
import { findSegment, segmentCondition } from "@/server/segments";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

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
 * The link to somebody's own preferences.
 *
 * Signed over the member row they arrived by, which is enough to find both
 * the address and the organisation. Its own prefix, so it cannot be used as
 * an unsubscribe link or the other way round.
 */
export function preferencesToken(memberId: string) {
  const mac = createHmac("sha256", env.authSecret).update(`prefs:${memberId}`).digest("base64url");
  return `${memberId}.${mac}`;
}

export function readPreferencesToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const memberId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(
    createHmac("sha256", env.authSecret).update(`prefs:${memberId}`).digest("base64url"),
  );

  if (given.length !== want.length) return null;
  return timingSafeEqual(given, want) ? memberId : null;
}

export function preferencesUrl(memberId: string) {
  return `${env.appUrl}/preferences/${preferencesToken(memberId)}`;
}

export interface Preference {
  memberId: string;
  listName: string;
  description: string | null;
  /** True when they are currently getting it. Pending counts as not yet. */
  on: boolean;
  /**
   * True when they cannot turn it back on from here.
   *
   * A hard bounce or a spam report is not a preference. Writing there again
   * costs the deliverability of everybody else on the list, and a stranger
   * with a forwarded link must not be able to undo a complaint.
   */
  locked: boolean;
}

/**
 * Every list in this organisation that this address is already known to.
 *
 * Known to, not every list there is. A preference centre that offered lists
 * somebody had never signed up to would be a subscription form wearing a
 * different hat, and the one thing this page must never do is add somebody to
 * something.
 */
export async function preferencesFor(memberId: string) {
  const who = await db.query.listMember.findFirst({
    where: eq(listMember.id, memberId),
    columns: { address: true, organizationId: true },
  });
  if (!who) return null;

  const rows = await db
    .select({
      memberId: listMember.id,
      status: listMember.status,
      listName: mailingList.name,
      description: mailingList.description,
    })
    .from(listMember)
    .innerJoin(mailingList, eq(mailingList.id, listMember.listId))
    .where(
      and(eq(listMember.organizationId, who.organizationId), eq(listMember.address, who.address)),
    )
    .orderBy(asc(mailingList.name));

  const site = await db.query.workspace.findFirst({
    where: eq(workspace.organizationId, who.organizationId),
    columns: { brandName: true },
  });

  return {
    address: who.address,
    brandName: site?.brandName ?? null,
    lists: rows.map(
      (row): Preference => ({
        memberId: row.memberId,
        listName: row.listName,
        description: row.description,
        on: row.status === "subscribed",
        locked: row.status === "bounced" || row.status === "complained",
      }),
    ),
  };
}

/**
 * What they chose, applied.
 *
 * `keep` is the member rows they left switched on. Anything of theirs not in
 * it is unsubscribed, which means an empty list is "stop everything" and
 * needs no separate button.
 *
 * Scoped to their own rows by address, so a token for one list cannot be used
 * to change somebody else's subscriptions by passing ids that are not theirs.
 */
export async function applyPreferences(memberId: string, keep: string[]) {
  const current = await preferencesFor(memberId);
  if (!current) return null;

  const mine = new Set(current.lists.map((row) => row.memberId));
  const wanted = new Set(keep.filter((id) => mine.has(id)));
  const now = new Date();

  for (const row of current.lists) {
    if (row.locked) continue;
    const on = wanted.has(row.memberId);
    if (on === row.on) continue;

    await db
      .update(listMember)
      .set(
        on
          ? {
              status: "subscribed",
              unsubscribedAt: null,
              // Fresh consent, recorded as such. They asked for this one back
              // from a link only they were sent, which is a stronger record
              // than whatever put them on it the first time.
              consentAt: now,
              consentSource: "preference centre",
            }
          : { status: "unsubscribed", unsubscribedAt: now },
      )
      .where(eq(listMember.id, row.memberId));
  }

  return preferencesFor(memberId);
}

/**
 * The link to the web copy of a campaign.
 *
 * Over the broadcast and nobody in particular, deliberately. A "view in
 * browser" link is the one in an email most likely to be forwarded to
 * somebody else, and a link that carried a recipient's identity would hand
 * that person's row to whoever it was forwarded to.
 *
 * It also means the page can be cached and shared, which is what people
 * actually want from it.
 */
export function archiveToken(broadcastId: string) {
  const mac = createHmac("sha256", env.authSecret)
    .update(`archive:${broadcastId}`)
    .digest("base64url");
  return `${broadcastId}.${mac}`;
}

export function readArchiveToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const broadcastId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(
    createHmac("sha256", env.authSecret).update(`archive:${broadcastId}`).digest("base64url"),
  );

  if (given.length !== want.length) return null;
  return timingSafeEqual(given, want) ? broadcastId : null;
}

export function archiveUrl(broadcastId: string) {
  return `${env.appUrl}/archive/${archiveToken(broadcastId)}`;
}

/**
 * The web copy of one campaign, or null.
 *
 * A draft has none: there is nothing to look back at, and a link that worked
 * before a campaign was sent would be a way to read one early.
 */
export async function archivedBroadcast(broadcastId: string) {
  const row = await db.query.broadcast.findFirst({
    where: eq(broadcast.id, broadcastId),
    columns: { id: true, subject: true, html: true, design: true, status: true, startedAt: true },
  });
  if (!row || row.status === "draft" || row.status === "cancelled") return null;

  const html = row.html ?? (row.design ? renderDesign(row.design, env.appUrl) : null);
  if (!html) return null;

  return { subject: row.subject, html, sentAt: row.startedAt };
}

/**
 * The link in a "please confirm" email.
 *
 * Signed the same way as an unsubscribe link, but over a different string, so
 * one cannot be used as the other. A confirmation link that also unsubscribed
 * — or the other way round — would be a bug nobody found until it mattered.
 */
export function confirmToken(memberId: string) {
  const mac = createHmac("sha256", env.authSecret)
    .update(`confirm:${memberId}`)
    .digest("base64url");
  return `${memberId}.${mac}`;
}

export function readConfirmToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const memberId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(
    createHmac("sha256", env.authSecret).update(`confirm:${memberId}`).digest("base64url"),
  );

  if (given.length !== want.length) return null;
  return timingSafeEqual(given, want) ? memberId : null;
}

export function confirmUrl(memberId: string) {
  return `${env.appUrl}/subscribe/confirm/${confirmToken(memberId)}`;
}

/**
 * Turns a pending member into a subscribed one.
 *
 * Idempotent, because a confirmation link gets clicked twice — once by the
 * person and once by their mail provider's link scanner — and the second must
 * look like the first worked.
 */
export async function confirmByToken(token: string) {
  const memberId = readConfirmToken(token);
  if (!memberId) return null;

  const row = await db.query.listMember.findFirst({ where: eq(listMember.id, memberId) });
  if (!row) return null;

  if (row.status === "pending") {
    await db
      .update(listMember)
      .set({
        status: "subscribed",
        confirmedAt: new Date(),
        consentAt: row.consentAt ?? new Date(),
      })
      .where(eq(listMember.id, memberId));
  }

  const list = await db.query.mailingList.findFirst({
    where: eq(mailingList.id, row.listId),
    columns: { name: true },
  });

  return {
    address: row.address,
    listName: list?.name ?? "this list",
    /** False when they had already confirmed, so the page can say so gently. */
    fresh: row.status === "pending",
  };
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

  if (row.status === "subscribed" || row.status === "pending") {
    await db
      .update(listMember)
      .set({ status: "unsubscribed", unsubscribedAt: new Date() })
      .where(eq(listMember.id, memberId));

    /*
     * Which campaign lost them.
     *
     * Stamped on their most recent sent copy rather than counted separately,
     * because the only question worth asking is "did this one cost us
     * people" — and that is a number per campaign, not per person.
     */
    const [latest] = await db
      .select({ id: broadcastRecipient.id })
      .from(broadcastRecipient)
      .where(
        and(
          eq(broadcastRecipient.listMemberId, memberId),
          eq(broadcastRecipient.status, "sent"),
          isNull(broadcastRecipient.unsubscribedAt),
        ),
      )
      .orderBy(desc(broadcastRecipient.sentAt))
      .limit(1);

    if (latest) {
      await db
        .update(broadcastRecipient)
        .set({ unsubscribedAt: new Date() })
        .where(eq(broadcastRecipient.id, latest.id));
    }
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

/** How people are allowed to join a list, and whether they must confirm. */
export async function updateList(
  orgId: string,
  listId: string,
  input: {
    name?: string;
    description?: string | null;
    doubleOptIn?: boolean;
    publicSignup?: boolean;
  },
) {
  const row = await db.query.mailingList.findFirst({
    where: and(eq(mailingList.id, listId), eq(mailingList.organizationId, orgId)),
  });
  if (!row) throw new Error("No such list");

  await db
    .update(mailingList)
    .set({
      name: input.name?.trim() || row.name,
      description:
        input.description === undefined ? row.description : input.description?.trim() || null,
      doubleOptIn: input.doubleOptIn ?? row.doubleOptIn,
      publicSignup: input.publicSignup ?? row.publicSignup,
    })
    .where(eq(mailingList.id, row.id));
}

export async function findList(orgId: string, listId: string) {
  const row = await db.query.mailingList.findFirst({
    where: and(eq(mailingList.id, listId), eq(mailingList.organizationId, orgId)),
  });
  return row ?? null;
}

/** A list anyone may sign up to, looked up without an account. */
export async function publicList(listId: string) {
  const row = await db.query.mailingList.findFirst({
    where: and(eq(mailingList.id, listId), eq(mailingList.publicSignup, true)),
  });
  return row ?? null;
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
  /** Asked to join a double opt-in list and has not clicked the link yet. */
  pending: number;
  total: number;
  doubleOptIn: boolean;
  publicSignup: boolean;
}

/**
 * The lists somebody may see.
 *
 * `only` is the answer from `readableLists`: "all" when there is nothing to
 * filter by — whoever runs the place, or a grant on every list — and a set of
 * ids otherwise. Passing the ids rather than the person keeps this a query
 * about data instead of a second place that decides who may see what.
 */
export async function listsView(orgId: string, only: "all" | string[] = "all"): Promise<ListRow[]> {
  if (only !== "all" && only.length === 0) return [];

  const lists = await db.query.mailingList.findMany({
    where:
      only === "all"
        ? eq(mailingList.organizationId, orgId)
        : and(eq(mailingList.organizationId, orgId), inArray(mailingList.id, only)),
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
      pending: mine.find((entry) => entry.status === "pending")?.howMany ?? 0,
      total: mine.reduce((sum, entry) => sum + entry.howMany, 0),
      doubleOptIn: row.doubleOptIn,
      publicSignup: row.publicSignup,
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
 * Splits one CSV line, respecting quotes.
 *
 * `"Lovelace, Ada",ada@example.com` is two fields, not three. Every export
 * from every other mailing tool quotes names that way, so splitting on commas
 * alone turns a normal export into nonsense.
 */
function splitRow(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];

    if (quoted) {
      // "" inside a quoted field is one literal quote.
      if (character === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      out.push(field.trim());
      field = "";
    } else field += character;
  }

  out.push(field.trim());
  return out;
}

/** Which column holds what, when the file came with a header row. */
function readHeader(cells: string[]) {
  const lower = cells.map((cell) => cell.toLowerCase().replace(/[\s_-]/g, ""));
  const address = lower.findIndex((cell) =>
    ["email", "emailaddress", "address", "e-mail", "mail"].includes(cell),
  );
  if (address === -1) return null;

  const name = lower.findIndex((cell) =>
    ["name", "fullname", "firstname", "displayname"].includes(cell),
  );
  return { address, name, labels: cells };
}

/**
 * Whatever somebody pasted or uploaded, as people.
 *
 * Handles the three shapes that actually turn up: one address per line, an
 * `address, name` pair per line, and a CSV exported from something else with
 * a header row naming its columns.
 *
 * A header is detected rather than demanded, because half of what gets pasted
 * in has none. Columns beyond address and name are kept as merge fields, so an
 * export carrying a plan or a city can be used in a subject line without
 * anybody having to reshape the file first.
 */
export function parseMemberList(text: string): MemberInput[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(splitRow);

  if (rows.length === 0) return [];

  const header = rows[0] ? readHeader(rows[0]) : null;
  const body = header ? rows.slice(1) : rows;

  return body.map((cells) => {
    if (!header) {
      return { address: cells[0] ?? "", name: cells.slice(1).join(", ").trim() || null };
    }

    const fields: Record<string, string> = {};
    for (let i = 0; i < cells.length; i += 1) {
      if (i === header.address || i === header.name) continue;
      const label = header.labels[i]?.trim();
      const value = cells[i]?.trim();
      if (label && value) fields[label] = value;
    }

    return {
      address: cells[header.address] ?? "",
      name: (header.name === -1 ? null : cells[header.name]?.trim()) || null,
      fields,
    };
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
  status: ListMemberStatus;
  /** Labels put on them by hand or by an automation. */
  tags: string[];
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
      tags: row.tags,
      consentSource: row.consentSource,
      consentAt: row.consentAt,
    }),
  );
}

/**
 * Which merge fields the people on each list actually carry.
 *
 * Read from the rows rather than from a schema, because there is no schema:
 * a field arrives because a CSV had a column named after it, because an API
 * call sent it, or because a Set a field box wrote it. Nobody declares them.
 *
 * Without this the feature is invisible — somebody has to already know that
 * `{{plan}}` will work before they will ever type it.
 */
export async function fieldNamesByList(orgId: string): Promise<Record<string, string[]>> {
  const rows = await db
    .select({
      listId: listMember.listId,
      name: sql<string>`jsonb_object_keys(${listMember.fields})`,
    })
    .from(listMember)
    .where(eq(listMember.organizationId, orgId))
    .groupBy(listMember.listId, sql`2`)
    .orderBy(listMember.listId, sql`2`);

  const byList: Record<string, string[]> = {};
  for (const row of rows) {
    if (!row.name) continue;
    // A handful is a help and forty is a wall of chips nobody reads.
    const seen = byList[row.listId] ?? [];
    byList[row.listId] = seen;
    if (seen.length < 24) seen.push(row.name);
  }
  return byList;
}

/**
 * A quoted CSV cell.
 *
 * Everything is quoted rather than only what needs it. A name with a comma in
 * it is the normal case, not the exception, and deciding cell by cell is how
 * an export ends up with one broken row in ten thousand that nobody notices
 * until it has been imported somewhere else.
 */
function cell(value: string | null | undefined) {
  return `"${(value ?? "").replace(/"/g, '""')}"`;
}

/**
 * Everybody on a list, or everybody a segment describes, as a CSV.
 *
 * The answer to "can I get my people back out". A tool that imports and does
 * not export is a tool people are right to be wary of putting a list into,
 * and the question gets asked before the first campaign rather than after it.
 *
 * Streamed as one string rather than a file: a list large enough for this to
 * matter is large enough that the browser should not be waiting on it, but a
 * hundred thousand rows is still only a few megabytes.
 */
export async function exportMembers(
  orgId: string,
  listId: string,
  segmentId?: string | null,
): Promise<string> {
  const narrowing = segmentId ? await findSegment(orgId, segmentId) : null;
  if (segmentId && (!narrowing || narrowing.listId !== listId)) {
    throw new Error("That segment is not about this list");
  }

  const rows = await db
    .select({
      address: listMember.address,
      name: listMember.name,
      status: listMember.status,
      tags: listMember.tags,
      fields: listMember.fields,
      consentSource: listMember.consentSource,
      consentAt: listMember.consentAt,
      confirmedAt: listMember.confirmedAt,
      unsubscribedAt: listMember.unsubscribedAt,
    })
    .from(listMember)
    .where(
      and(
        eq(listMember.organizationId, orgId),
        eq(listMember.listId, listId),
        narrowing ? segmentCondition(narrowing) : undefined,
      ),
    )
    .orderBy(asc(listMember.address));

  // Every merge field anybody on this list carries becomes a column, so the
  // file that comes out can go straight back into the file that went in.
  const extras: string[] = [];
  for (const row of rows) {
    for (const name of Object.keys(row.fields ?? {})) {
      if (!extras.includes(name)) extras.push(name);
    }
  }
  extras.sort();

  const header = [
    "email",
    "name",
    "status",
    "tags",
    "consent_source",
    "consent_at",
    "confirmed_at",
    "unsubscribed_at",
    ...extras,
  ];

  const lines = [header.map(cell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        cell(row.address),
        cell(row.name),
        cell(row.status),
        cell(row.tags.join(" ")),
        cell(row.consentSource),
        cell(row.consentAt?.toISOString()),
        cell(row.confirmedAt?.toISOString()),
        cell(row.unsubscribedAt?.toISOString()),
        ...extras.map((name) => cell(row.fields?.[name])),
      ].join(","),
    );
  }

  // A trailing newline: a file without one is a file some tools drop the last
  // row of, and the last row is somebody.
  return `${lines.join("\n")}\n`;
}

/* -------------------------------------------------------------------------- */
/* Broadcasts                                                                 */
/* -------------------------------------------------------------------------- */

export async function createBroadcast(
  orgId: string,
  input: {
    /** Both left out while the campaign is only being written. */
    listId?: string | null;
    mailboxId?: string | null;
    subject: string;
    html?: string;
    text?: string;
    /** Start from a saved template: its subject and its blocks are copied. */
    templateId?: string | null;
    /** Narrow the list to part of it. */
    segmentId?: string | null;
  },
) {
  const subject = input.subject.trim();
  if (!subject) throw new Error("Give the broadcast a subject");

  const [list, box] = await Promise.all([
    input.listId
      ? db.query.mailingList.findFirst({
          where: and(eq(mailingList.id, input.listId), eq(mailingList.organizationId, orgId)),
          columns: { id: true },
        })
      : null,
    input.mailboxId
      ? db.query.mailbox.findFirst({
          where: and(eq(mailbox.id, input.mailboxId), eq(mailbox.organizationId, orgId)),
          columns: { id: true },
        })
      : null,
  ]);
  if (input.listId && !list) throw new Error("No such list");
  if (input.mailboxId && !box) throw new Error("No such mailbox");

  /*
   * A template is copied, not referenced. A broadcast is a thing that was
   * sent on a day, and the template it came from will be edited afterwards —
   * pointing at it would mean the record of what went out changes every time
   * somebody fixes a typo for the next one.
   */
  let from: { subject?: string; html?: string | null; text?: string | null; design?: unknown } = {};
  if (input.templateId) {
    const { findTemplate } = await import("./templates");
    const row = await findTemplate(orgId, input.templateId);
    if (!row) throw new Error("No such template");
    from = { subject: row.subject, html: row.html, text: row.text, design: row.design };
  }

  // A segment that belongs to a different list would silently send to nobody.
  if (input.segmentId) {
    const chosen = await findSegment(orgId, input.segmentId);
    if (!chosen || chosen.listId !== input.listId) throw new Error("No such segment");
  }

  const id = newId("bct");
  await db.insert(broadcast).values({
    id,
    organizationId: orgId,
    listId: input.listId ?? null,
    mailboxId: input.mailboxId ?? null,
    segmentId: input.segmentId ?? null,
    subject: subject || from.subject || "",
    html: input.html ?? from.html ?? null,
    text: input.text ?? from.text ?? null,
    design: (from.design as never) ?? null,
  });
  return id;
}

/**
 * Changes a draft's subject and body.
 *
 * Only a draft. Once a broadcast has started, what went out is what went out,
 * and a record that can be edited afterwards is not a record.
 */
export async function updateBroadcast(
  orgId: string,
  id: string,
  input: {
    subject?: string;
    /** The rival subject line, or null to stop testing. */
    subjectB?: string | null;
    listId?: string;
    mailboxId?: string;
    segmentId?: string | null;
    design?: EmailDesign | null;
    html?: string | null;
    text?: string | null;
  },
) {
  const row = await db.query.broadcast.findFirst({
    where: and(eq(broadcast.id, id), eq(broadcast.organizationId, orgId)),
  });
  if (!row) throw new Error("No such broadcast");
  if (row.status !== "draft") throw new Error("That broadcast has already been sent");

  // The same rule as a template: a design decides the body, compiled here so
  // the canvas and what goes out cannot disagree.
  const body = input.design
    ? { html: renderDesign(input.design, env.appUrl), text: designToText(input.design) }
    : { html: input.html, text: input.text };

  /*
   * Changing the list drops the segment with it.
   *
   * A segment belongs to one list, so keeping it would leave a campaign
   * pointing at a question about a different set of people — which sends to
   * nobody, silently, and looks like a bug in the send rather than a stale
   * field here.
   */
  const listId = input.listId ?? row.listId;
  if (input.listId && input.listId !== row.listId) {
    const list = await db.query.mailingList.findFirst({
      where: and(eq(mailingList.id, input.listId), eq(mailingList.organizationId, orgId)),
      columns: { id: true },
    });
    if (!list) throw new Error("No such list");
  }

  if (input.mailboxId) {
    const box = await db.query.mailbox.findFirst({
      where: and(eq(mailbox.id, input.mailboxId), eq(mailbox.organizationId, orgId)),
      columns: { id: true },
    });
    if (!box) throw new Error("No such mailbox");
  }

  const segmentId =
    input.listId && input.listId !== row.listId
      ? (input.segmentId ?? null)
      : input.segmentId === undefined
        ? row.segmentId
        : input.segmentId;

  if (segmentId) {
    const chosen = await findSegment(orgId, segmentId);
    if (!chosen || chosen.listId !== listId) throw new Error("No such segment");
  }

  await db
    .update(broadcast)
    .set({
      listId,
      mailboxId: input.mailboxId ?? row.mailboxId,
      subject: input.subject?.trim() || row.subject,
      subjectB: input.subjectB === undefined ? row.subjectB : input.subjectB?.trim() || null,
      segmentId,
      html: body.html === undefined ? row.html : (body.html ?? null),
      text: body.text === undefined ? row.text : (body.text ?? null),
      design: input.design === undefined ? row.design : input.design,
    })
    .where(eq(broadcast.id, row.id));

  return row.id;
}

export async function findBroadcast(orgId: string, id: string) {
  const row = await db.query.broadcast.findFirst({
    where: and(eq(broadcast.id, id), eq(broadcast.organizationId, orgId)),
  });
  return row ?? null;
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
  // Where the two optional halves of a draft stop being optional.
  if (!row.listId) throw new Error("Choose a list for this campaign before sending it");
  if (!row.mailboxId) throw new Error("Choose an address to send this campaign from");

  const audience = await audienceFor(orgId, row);
  if (audience.length === 0) {
    throw new Error(
      row.resendOfId
        ? "Everybody who was sent the original has opened it"
        : row.segmentId
          ? "Nobody on that list matches the segment"
          : "Nobody on that list is subscribed",
    );
  }

  const testing = Boolean(row.subjectB?.trim());
  await db
    .insert(broadcastRecipient)
    .values(
      audience.map((person) => ({
        id: newId("bcr"),
        organizationId: orgId,
        broadcastId,
        listMemberId: person.id,
        address: person.address,
        variant: testing ? variantFor(broadcastId, person.id) : ("a" as const),
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

/**
 * Which half of an A/B test somebody lands in.
 *
 * Hashed rather than counted, so the split does not depend on the order rows
 * come back in and is identical if a send is ever rebuilt. The broadcast id is
 * mixed in so the same person is not permanently the "variant A" person across
 * every campaign — that would make every test measure the same group twice.
 */
export function variantFor(broadcastId: string, memberId: string): "a" | "b" {
  const digest = createHash("sha256").update(`${broadcastId}:${memberId}`).digest();
  return (digest[0] & 1) === 0 ? "a" : "b";
}

/**
 * Who a campaign actually goes to.
 *
 * Three cases, in order of how specific they are. A follow-up takes its
 * audience from the campaign it follows, because somebody who joined the list
 * afterwards was never sent the first one and a reminder about an email they
 * never received is nonsense. A segment narrows the list. Otherwise it is
 * everybody still subscribed.
 */
async function audienceFor(
  orgId: string,
  row: { listId: string | null; segmentId: string | null; resendOfId: string | null },
) {
  if (row.resendOfId) {
    return db
      .select({ id: listMember.id, address: listMember.address })
      .from(broadcastRecipient)
      .innerJoin(listMember, eq(listMember.id, broadcastRecipient.listMemberId))
      .where(
        and(
          eq(broadcastRecipient.broadcastId, row.resendOfId),
          eq(broadcastRecipient.status, "sent"),
          isNull(broadcastRecipient.openedAt),
          eq(listMember.status, "subscribed"),
        ),
      );
  }

  // A draft nobody has aimed yet goes to nobody, which is not an error here:
  // the builder asks this while somebody is still writing.
  if (!row.listId) return [];

  const chosen = row.segmentId ? await findSegment(orgId, row.segmentId) : null;

  return db
    .select({ id: listMember.id, address: listMember.address })
    .from(listMember)
    .where(
      and(
        eq(listMember.listId, row.listId),
        eq(listMember.status, "subscribed"),
        chosen ? segmentCondition(chosen) : undefined,
      ),
    );
}

/**
 * How many people a campaign would go to if it were sent now.
 *
 * An estimate by definition — the answer is taken again when it starts — but
 * it is the number somebody needs before they press Send, and "we will tell
 * you afterwards" is not an acceptable answer to "how many is this".
 */
export async function audienceSize(
  orgId: string,
  broadcastId: string,
  /**
   * The aim as it stands on screen, which is not always the saved one.
   *
   * A number beside a Send button that describes the row as it was two edits
   * ago is worse than no number, so the caller says what it is looking at
   * rather than the server assuming nothing has changed.
   */
  aim?: { listId?: string | null; segmentId?: string | null },
) {
  const row = await findBroadcast(orgId, broadcastId);
  if (!row) return 0;

  // Nobody, until it is pointed at somebody. Said as a number rather than as
  // an error: the builder asks this while a draft is still being written.
  const listId = aim?.listId || row.listId;
  if (!listId) return 0;

  const people = await audienceFor(orgId, {
    listId,
    segmentId: aim?.segmentId === undefined ? row.segmentId : aim.segmentId,
    resendOfId: row.resendOfId,
  });
  return people.length;
}

/**
 * Copies a campaign back into a draft.
 *
 * Everything about the message travels; nothing about the send does. A copy
 * that kept its schedule, its recipients or its numbers would be a lie about
 * something that never went out.
 */
export async function duplicateBroadcast(orgId: string, id: string) {
  const row = await findBroadcast(orgId, id);
  if (!row) throw new Error("No such broadcast");

  const made = newId("bct");
  await db.insert(broadcast).values({
    id: made,
    organizationId: orgId,
    listId: row.listId,
    mailboxId: row.mailboxId,
    segmentId: row.segmentId,
    subject: `${row.subject} (copy)`,
    subjectB: row.subjectB,
    html: row.html,
    text: row.text,
    design: row.design,
  });
  return made;
}

/**
 * A second attempt, aimed only at the people who never opened the first.
 *
 * Made as a draft rather than sent, because the whole point is to change the
 * subject line — sending the identical email to the same inbox a second time
 * is how a sender teaches a mailbox provider to filter them.
 */
export async function resendToNonOpeners(orgId: string, id: string) {
  const row = await findBroadcast(orgId, id);
  if (!row) throw new Error("No such broadcast");
  if (row.status !== "sent") throw new Error("That campaign has not finished sending");

  const [pending] = await db
    .select({ howMany: sql<number>`count(*)`.mapWith(Number) })
    .from(broadcastRecipient)
    .where(
      and(
        eq(broadcastRecipient.broadcastId, id),
        eq(broadcastRecipient.status, "sent"),
        isNull(broadcastRecipient.openedAt),
      ),
    );
  if ((pending?.howMany ?? 0) === 0) throw new Error("Everybody who got it has opened it");

  const made = newId("bct");
  await db.insert(broadcast).values({
    id: made,
    organizationId: orgId,
    listId: row.listId,
    mailboxId: row.mailboxId,
    resendOfId: row.id,
    subject: row.subject,
    html: row.html,
    text: row.text,
    design: row.design,
  });

  return { id: made, audience: pending?.howMany ?? 0 };
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
  /** Null while it is a draft nobody has aimed yet. */
  listId: string | null;
  listName: string | null;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  scheduledAt: Date | null;
  createdAt: Date;
  total: number;
  sent: number;
  failed: number;
  opened: number;
}

export async function broadcastsView(
  orgId: string,
  only: "all" | string[] = "all",
): Promise<BroadcastRow[]> {
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
    .leftJoin(mailingList, eq(mailingList.id, broadcast.listId))
    .where(
      only === "all"
        ? eq(broadcast.organizationId, orgId)
        : and(
            eq(broadcast.organizationId, orgId),
            /*
             * A campaign aimed at nobody is still visible.
             *
             * A draft has no audience yet, so there is no audience to be kept
             * away from — and hiding one would mean somebody who starts a
             * campaign before choosing a list watches it disappear.
             */
            or(
              isNull(broadcast.listId),
              only.length > 0 ? inArray(broadcast.listId, only) : sql`false`,
            ),
          ),
    )
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

/* -------------------------------------------------------------------------- */
/* The report                                                                 */
/* -------------------------------------------------------------------------- */

export interface VariantTally {
  variant: "a" | "b";
  subject: string;
  sent: number;
  opened: number;
  clicked: number;
}

export interface LinkTally {
  url: string;
  /** People, not clicks. The second number is there for whoever wants it. */
  people: number;
  clicks: number;
}

export interface BroadcastReport {
  id: string;
  subject: string;
  subjectB: string | null;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  listName: string | null;
  segmentName: string | null;
  resendOfId: string | null;
  from: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  scheduledAt: Date | null;

  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  bounced: number;
  complained: number;

  /** The public web copy, once there is one. Null on a draft. */
  webUrl: string | null;

  variants: VariantTally[];
  links: LinkTally[];
  /** The people it went to, newest activity first. Capped; the list is for eyes. */
  recipients: {
    address: string;
    status: "pending" | "sent" | "failed" | "skipped";
    variant: "a" | "b";
    openedAt: Date | null;
    clickedAt: Date | null;
    unsubscribedAt: Date | null;
    error: string | null;
  }[];
}

/** At most this many recipient rows. Beyond it the list stops being readable. */
const RECIPIENTS_SHOWN = 200;

/**
 * Everything one campaign did, in one query each.
 *
 * Rates are not computed here. A report hands over counts and lets whatever
 * draws it decide what to divide by — "opened over sent" and "opened over
 * delivered" are different numbers, and burying that choice in the server is
 * how two screens end up disagreeing about the same campaign.
 */
export async function broadcastReport(orgId: string, id: string): Promise<BroadcastReport | null> {
  const [head] = await db
    .select({
      id: broadcast.id,
      subject: broadcast.subject,
      subjectB: broadcast.subjectB,
      status: broadcast.status,
      listName: mailingList.name,
      segmentId: broadcast.segmentId,
      resendOfId: broadcast.resendOfId,
      from: mailbox.address,
      startedAt: broadcast.startedAt,
      finishedAt: broadcast.finishedAt,
      scheduledAt: broadcast.scheduledAt,
    })
    .from(broadcast)
    .leftJoin(mailingList, eq(mailingList.id, broadcast.listId))
    .innerJoin(mailbox, eq(mailbox.id, broadcast.mailboxId))
    .where(and(eq(broadcast.id, id), eq(broadcast.organizationId, orgId)))
    .limit(1);
  if (!head) return null;

  const [tallies, byVariant, links, recipients, segmentRow] = await Promise.all([
    db
      .select({
        status: broadcastRecipient.status,
        howMany: count(),
        opened: sql<number>`count(${broadcastRecipient.openedAt})`.mapWith(Number),
        clicked: sql<number>`count(${broadcastRecipient.clickedAt})`.mapWith(Number),
        left: sql<number>`count(${broadcastRecipient.unsubscribedAt})`.mapWith(Number),
      })
      .from(broadcastRecipient)
      .where(eq(broadcastRecipient.broadcastId, id))
      .groupBy(broadcastRecipient.status),

    db
      .select({
        variant: broadcastRecipient.variant,
        sent: sql<number>`count(*) filter (where ${broadcastRecipient.status} = 'sent')`.mapWith(
          Number,
        ),
        opened: sql<number>`count(${broadcastRecipient.openedAt})`.mapWith(Number),
        clicked: sql<number>`count(${broadcastRecipient.clickedAt})`.mapWith(Number),
      })
      .from(broadcastRecipient)
      .where(eq(broadcastRecipient.broadcastId, id))
      .groupBy(broadcastRecipient.variant),

    db
      .select({
        url: broadcastClick.url,
        people: sql<number>`count(distinct ${broadcastClick.recipientId})`.mapWith(Number),
        clicks: sql<number>`coalesce(sum(${broadcastClick.clicks}), 0)`.mapWith(Number),
      })
      .from(broadcastClick)
      .where(eq(broadcastClick.broadcastId, id))
      .groupBy(broadcastClick.url)
      .orderBy(desc(sql`count(distinct ${broadcastClick.recipientId})`))
      .limit(25),

    db
      .select({
        address: broadcastRecipient.address,
        status: broadcastRecipient.status,
        variant: broadcastRecipient.variant,
        openedAt: broadcastRecipient.openedAt,
        clickedAt: broadcastRecipient.clickedAt,
        unsubscribedAt: broadcastRecipient.unsubscribedAt,
        error: broadcastRecipient.error,
      })
      .from(broadcastRecipient)
      .where(eq(broadcastRecipient.broadcastId, id))
      .orderBy(
        desc(broadcastRecipient.clickedAt),
        desc(broadcastRecipient.openedAt),
        asc(broadcastRecipient.address),
      )
      .limit(RECIPIENTS_SHOWN),

    head.segmentId
      ? db.query.segment.findFirst({
          where: eq(segment.id, head.segmentId),
          columns: { name: true },
        })
      : Promise.resolve(null),
  ]);

  /*
   * A bounce or a complaint is recorded against the message, not against the
   * recipient row, because it arrives from SES long after the send finished.
   * Counted by joining back rather than duplicated onto the recipient, so
   * there is one place that knows what a bounce is.
   */
  const [feedback] = await db
    .select({
      bounced: sql<number>`count(*) filter (where ${message.deliveryStatus} = 'bounced')`.mapWith(
        Number,
      ),
      complained:
        sql<number>`count(*) filter (where ${message.deliveryStatus} = 'complained')`.mapWith(
          Number,
        ),
    })
    .from(broadcastRecipient)
    .innerJoin(message, eq(message.id, broadcastRecipient.messageId))
    .where(eq(broadcastRecipient.broadcastId, id));

  const at = (status: string) => tallies.find((row) => row.status === status)?.howMany ?? 0;
  const subjects: Record<"a" | "b", string> = {
    a: head.subject,
    b: head.subjectB ?? head.subject,
  };

  return {
    ...head,
    segmentName: segmentRow?.name ?? null,
    total: tallies.reduce((sum, row) => sum + row.howMany, 0),
    sent: at("sent"),
    failed: at("failed"),
    skipped: at("skipped"),
    pending: at("pending"),
    opened: tallies.reduce((sum, row) => sum + row.opened, 0),
    clicked: tallies.reduce((sum, row) => sum + row.clicked, 0),
    unsubscribed: tallies.reduce((sum, row) => sum + row.left, 0),
    bounced: feedback?.bounced ?? 0,
    complained: feedback?.complained ?? 0,
    // A draft has no web copy: a link that worked before a campaign was sent
    // would be a way to read one early.
    webUrl: head.status === "draft" || head.status === "cancelled" ? null : archiveUrl(id),
    variants: byVariant
      .map((row) => ({ ...row, subject: subjects[row.variant] }))
      .sort((left, right) => left.variant.localeCompare(right.variant)),
    links,
    recipients,
  };
}

/** Mailboxes a broadcast can be sent from, for the composer's picker. */
export async function sendableMailboxes(orgId: string) {
  return db
    .select({ id: mailbox.id, address: mailbox.address })
    .from(mailbox)
    .where(eq(mailbox.organizationId, orgId))
    .orderBy(asc(mailbox.address));
}

/* -------------------------------------------------------------------------- */
/* The overview                                                               */
/* -------------------------------------------------------------------------- */

/** How far back the moving numbers look. */
const RECENTLY = 30;

export interface CampaignsOverview {
  lists: number;
  subscribers: number;
  unsubscribed: number;
  /** Joined and left in the last 30 days: which way the audience is going. */
  joined: number;
  left: number;
  broadcastsSent: number;
  delivered: number;
  /** Null rather than zero when nothing has been sent: 0% reads as a failure. */
  openRate: number | null;
  clickRate: number | null;
  /**
   * The two that decide whether any of the others ever happen again.
   *
   * Gmail's bulk sender rules put the complaint rate somewhere under 0.3%,
   * and a hard bounce rate over a few per cent is what gets an SES account
   * reviewed. Every other number on this screen is about how a campaign did.
   * These are about whether there will be a next one.
   */
  bounceRate: number | null;
  complaintRate: number | null;
  /** Automations switched on, and people part-way through one right now. */
  automationsLive: number;
  inFlight: number;
  /** Event names declared, and how many have ever arrived. */
  eventNames: number;
  eventsSeen: number;
  recent: BroadcastRow[];
}

/** The people on the lists this view covers. */
function memberScope(orgId: string, only: "all" | string[]) {
  if (only === "all") return eq(listMember.organizationId, orgId);
  if (only.length === 0) return sql`false`;
  return and(eq(listMember.organizationId, orgId), inArray(listMember.listId, only));
}

export async function campaignsOverview(
  orgId: string,
  only: "all" | string[] = "all",
): Promise<CampaignsOverview> {
  const since = new Date(Date.now() - RECENTLY * 24 * 60 * 60 * 1000);

  const [lists, tallies, broadcasts, movement, feedback, flows, running, events] =
    await Promise.all([
      db.$count(
        mailingList,
        only === "all"
          ? eq(mailingList.organizationId, orgId)
          : and(eq(mailingList.organizationId, orgId), inArray(mailingList.id, only)),
      ),
      db
        .select({ status: listMember.status, howMany: count() })
        .from(listMember)
        .where(memberScope(orgId, only))
        .groupBy(listMember.status),
      broadcastsView(orgId, only),
      db
        .select({
          joined:
            sql<number>`count(*) filter (where ${listMember.consentAt} >= ${since.toISOString()}::timestamptz)`.mapWith(
              Number,
            ),
          left: sql<number>`count(*) filter (where ${listMember.unsubscribedAt} >= ${since.toISOString()}::timestamptz)`.mapWith(
            Number,
          ),
        })
        .from(listMember)
        .where(memberScope(orgId, only)),
      /*
       * Asked of the message rows rather than the recipient rows, because a
       * bounce arrives from SES hours later against the message and never
       * touches the recipient row that started it.
       */
      db
        .select({
          clicked:
            sql<number>`count(*) filter (where ${broadcastRecipient.clickedAt} is not null)`.mapWith(
              Number,
            ),
          bounced:
            sql<number>`count(*) filter (where ${message.deliveryStatus} = 'bounced')`.mapWith(
              Number,
            ),
          complained:
            sql<number>`count(*) filter (where ${message.deliveryStatus} = 'complained')`.mapWith(
              Number,
            ),
        })
        .from(broadcastRecipient)
        .leftJoin(message, eq(message.id, broadcastRecipient.messageId))
        .where(
          and(eq(broadcastRecipient.organizationId, orgId), eq(broadcastRecipient.status, "sent")),
        ),
      db.$count(
        automation,
        and(eq(automation.organizationId, orgId), eq(automation.status, "active")),
      ),
      db.$count(
        automationRun,
        and(eq(automationRun.organizationId, orgId), eq(automationRun.status, "active")),
      ),
      db
        .select({
          names: count(),
          seen: sql<number>`coalesce(sum(${customEvent.seenCount}), 0)`.mapWith(Number),
        })
        .from(customEvent)
        .where(eq(customEvent.organizationId, orgId)),
    ]);

  const delivered = broadcasts.reduce((sum, row) => sum + row.sent, 0);
  const opened = broadcasts.reduce((sum, row) => sum + row.opened, 0);
  const rate = (howMany: number) =>
    delivered > 0 ? Math.round((howMany / delivered) * 1000) / 10 : null;

  return {
    lists,
    subscribers: tallies.find((row) => row.status === "subscribed")?.howMany ?? 0,
    unsubscribed: tallies.find((row) => row.status === "unsubscribed")?.howMany ?? 0,
    joined: movement[0]?.joined ?? 0,
    left: movement[0]?.left ?? 0,
    broadcastsSent: broadcasts.filter((row) => row.status === "sent").length,
    delivered,
    // Whole per cent for the two that are usually large, a decimal for the two
    // that matter at a tenth of one.
    openRate: delivered > 0 ? Math.round((opened / delivered) * 100) : null,
    clickRate: delivered > 0 ? Math.round(((feedback[0]?.clicked ?? 0) / delivered) * 100) : null,
    bounceRate: rate(feedback[0]?.bounced ?? 0),
    complaintRate: rate(feedback[0]?.complained ?? 0),
    automationsLive: flows,
    inFlight: running,
    eventNames: events[0]?.names ?? 0,
    eventsSeen: events[0]?.seen ?? 0,
    recent: broadcasts.slice(0, 5),
  };
}

/* -------------------------------------------------------------------------- */
/* Subscribing from somewhere else                                            */
/* -------------------------------------------------------------------------- */

/**
 * One person, from a signup form or somebody else's system.
 *
 * Separate from `addMembers` because the answer differs. An import wants
 * counts and does not care which addresses were already there; a signup form
 * is one person pressing a button and needs to know what happened to them.
 *
 * Somebody who unsubscribed and then signs up again is resubscribed here, and
 * only here. That is a deliberate act by the person themselves, which is the
 * one thing that should undo their own unsubscribe — an import never does.
 */
export async function subscribe(
  orgId: string,
  listId: string,
  input: { address: string; name?: string | null; fields?: Record<string, string> },
  consentSource: string,
) {
  const address = input.address.trim().toLowerCase();
  if (!EMAIL.test(address)) throw new Error("That is not an email address");

  const list = await db.query.mailingList.findFirst({
    where: and(eq(mailingList.id, listId), eq(mailingList.organizationId, orgId)),
    columns: { id: true, name: true, doubleOptIn: true },
  });
  if (!list) throw new Error("No such list");

  /*
   * On a double opt-in list nobody is subscribed by asking.
   *
   * They land as "pending", which every send query excludes, and become real
   * only by clicking the link in the email below. It costs half the list and
   * it is worth it: a signup form without it is a way for a stranger to sign
   * somebody else up, and that person reports the next campaign as spam.
   */
  const joining: ListMemberStatus = list.doubleOptIn ? "pending" : "subscribed";

  const existing = await db.query.listMember.findFirst({
    where: and(eq(listMember.listId, listId), eq(listMember.address, address)),
  });

  const now = new Date();

  if (existing) {
    if (existing.status === "subscribed") {
      return { id: existing.id, status: "already" as const };
    }

    /*
     * A hard bounce or a spam complaint is not undone by a form submission.
     * The address is broken or its owner reported us, and sending there again
     * costs the sending reputation of everybody else on the list.
     */
    if (existing.status !== "unsubscribed") {
      return { id: existing.id, status: "blocked" as const };
    }

    await db
      .update(listMember)
      .set({
        status: joining,
        unsubscribedAt: null,
        consentAt: now,
        consentSource,
        ...(input.name ? { name: input.name.trim() } : {}),
      })
      .where(eq(listMember.id, existing.id));

    if (joining === "pending") {
      await sendConfirmation(
        orgId,
        { id: existing.id, address, name: input.name ?? null },
        list.name,
      );
      return { id: existing.id, status: "pending" as const };
    }
    return { id: existing.id, status: "resubscribed" as const };
  }

  const id = newId("lsm");
  await db.insert(listMember).values({
    id,
    organizationId: orgId,
    listId,
    address,
    name: input.name?.trim() || null,
    fields: input.fields ?? {},
    status: joining,
    consentSource,
    consentAt: now,
  });

  if (joining === "pending") {
    await sendConfirmation(orgId, { id, address, name: input.name ?? null }, list.name);
    return { id, status: "pending" as const };
  }

  return { id, status: "subscribed" as const };
}

/**
 * The "did you mean to do this?" email.
 *
 * Sent from whichever mailbox the organisation has; there is no per-list from
 * address, and inventing one would be another thing to configure before a
 * signup form works at all. A failure here is swallowed on purpose — somebody
 * pressing Subscribe must not see a stack trace because SES was slow, and the
 * row already exists as pending for them to be reminded about.
 */
async function sendConfirmation(
  orgId: string,
  person: { id: string; address: string; name: string | null },
  listName: string,
) {
  const [box] = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(eq(mailbox.organizationId, orgId))
    .orderBy(asc(mailbox.address))
    .limit(1);
  if (!box) return;

  const url = confirmUrl(person.id);
  const { deliverMessage } = await import("./send");

  try {
    await deliverMessage({
      orgId,
      mailboxId: box.id,
      to: [{ address: person.address, name: person.name }],
      subject: `Confirm your subscription to ${listName}`,
      html: [
        `<p>Somebody — we hope you — asked to join <strong>${escapeHtml(listName)}</strong>.</p>`,
        `<p><a href="${url}">Yes, subscribe me</a></p>`,
        '<p style="color:#6b7280;font-size:12px">If it was not you, ignore this email. Nothing will be sent until the link above is clicked.</p>',
      ].join(""),
      text: `Somebody asked to join ${listName}.\n\nConfirm: ${url}\n\nIf it was not you, ignore this email. Nothing will be sent until that link is clicked.`,
    });
  } catch {
    // Already pending; a resend is a button elsewhere rather than a crash here.
  }
}

/** The few characters that matter inside the confirmation body. */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Taking somebody off a list by address, for a client that has no member id. */
export async function unsubscribeAddress(orgId: string, listId: string, rawAddress: string) {
  const address = rawAddress.trim().toLowerCase();
  const row = await db.query.listMember.findFirst({
    where: and(
      eq(listMember.organizationId, orgId),
      eq(listMember.listId, listId),
      eq(listMember.address, address),
    ),
  });
  if (!row) return null;

  if (row.status === "subscribed") {
    await db
      .update(listMember)
      .set({ status: "unsubscribed", unsubscribedAt: new Date() })
      .where(eq(listMember.id, row.id));
  }
  return { id: row.id };
}
