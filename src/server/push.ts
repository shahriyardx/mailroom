import "server-only";

import { db } from "@/db";
import { accessGrant, mailbox, member, pushSubscription, team, teamMember } from "@/db/schema";
import { env } from "@/lib/env";
import { newId } from "@/lib/utils";
import { and, eq, inArray, or } from "drizzle-orm";
import webpush from "web-push";

/**
 * Desktop notifications, for people who asked for them.
 *
 * The browser keeps a service worker registered whether or not the tab is
 * open, and the push service wakes it. That is the whole reason this exists
 * rather than a notification raised from the page: mail that arrives while
 * Mailroom is closed is exactly the mail worth being told about.
 *
 * Nothing here is ever allowed to fail a delivery. A push that does not go
 * out is a missed notice; a push that throws inside `ingest` would be a
 * message the worker retries and a mailbox that fills up twice.
 */

/** What a browser is sent. Small on purpose: it crosses somebody else's wire. */
export interface PushPayload {
  title: string;
  body: string;
  /** Where clicking it should land. */
  url: string;
  /** Collapses repeats about one conversation into one notification. */
  tag?: string;
}

let configured = false;

function ready() {
  if (!env.push.configured) return false;
  if (!configured) {
    webpush.setVapidDetails(
      // A push service wants a contact for the sender, and will reject a
      // bare instance URL. `mailto:` on the configured address is the form
      // every one of them accepts.
      env.push.subject || `mailto:admin@${new URL(env.appUrl).hostname}`,
      env.push.publicKey,
      env.push.privateKey,
    );
    configured = true;
  }
  return true;
}

/* -------------------------------------------------------------- the registry */

export interface BrowserKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
  label?: string;
}

/**
 * Remembers a browser, or refreshes what is already remembered about it.
 *
 * A browser that re-subscribes hands back the same endpoint, so this has to
 * be an upsert: registering again on every page load would otherwise leave a
 * person with a hundred rows and a hundred copies of every notification.
 */
export async function rememberBrowser(userId: string, keys: BrowserKeys) {
  await db
    .insert(pushSubscription)
    .values({
      id: newId("push"),
      userId,
      endpoint: keys.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      label: keys.label ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: {
        // The owner too: a shared machine can be signed into by somebody else,
        // and the endpoint then belongs to them.
        userId,
        p256dh: keys.p256dh,
        auth: keys.auth,
        label: keys.label ?? null,
        failures: 0,
        lastSeenAt: new Date(),
      },
    });
}

export async function forgetBrowser(userId: string, endpoint: string) {
  await db
    .delete(pushSubscription)
    .where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)));
}

export async function forgetEveryBrowser(userId: string) {
  await db.delete(pushSubscription).where(eq(pushSubscription.userId, userId));
}

export async function browsersFor(userId: string) {
  return db
    .select({
      id: pushSubscription.id,
      endpoint: pushSubscription.endpoint,
      label: pushSubscription.label,
      createdAt: pushSubscription.createdAt,
      lastSeenAt: pushSubscription.lastSeenAt,
    })
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, userId));
}

/* ------------------------------------------------- who is allowed to be told */

/**
 * The people who may read a mailbox, and so may be told about it.
 *
 * This is `mailboxRights` asked backwards: that one starts from a person and
 * finds their mailboxes, and a notification starts from a mailbox and needs
 * its people. Getting this wrong would push somebody else's subject line onto
 * a stranger's screen, so it is deliberately strict — the reach has to be
 * granted, not merely plausible.
 */
export async function readersOf(orgId: string, mailboxId: string): Promise<string[]> {
  const [box] = await db
    .select({ id: mailbox.id, domainId: mailbox.domainId })
    .from(mailbox)
    .where(and(eq(mailbox.id, mailboxId), eq(mailbox.organizationId, orgId)))
    .limit(1);
  if (!box) return [];

  const readers = new Set<string>();

  // The owner, and everybody in the root team, reach everything without a
  // grant — the same rule `getAccess` applies from the other direction.
  const owners = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")));
  for (const row of owners) readers.add(row.userId);

  const rootTeam = await db
    .select({ userId: teamMember.userId })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(and(eq(team.organizationId, orgId), eq(team.isRoot, true)));
  for (const row of rootTeam) readers.add(row.userId);

  // Then whatever has been granted, on the mailbox itself or on its domain.
  const resources = [box.id, ...(box.domainId ? [box.domainId] : [])];
  const grants = await db
    .select({ subjectType: accessGrant.subjectType, subjectId: accessGrant.subjectId })
    .from(accessGrant)
    .where(
      and(
        eq(accessGrant.organizationId, orgId),
        eq(accessGrant.canRead, true),
        inArray(accessGrant.resourceId, resources),
        or(eq(accessGrant.resourceType, "mailbox"), eq(accessGrant.resourceType, "domain")),
      ),
    );

  const memberIds = grants.filter((g) => g.subjectType === "member").map((g) => g.subjectId);
  const teamIds = grants.filter((g) => g.subjectType === "team").map((g) => g.subjectId);

  if (memberIds.length > 0) {
    const rows = await db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, orgId), inArray(member.id, memberIds)));
    for (const row of rows) readers.add(row.userId);
  }

  if (teamIds.length > 0) {
    const rows = await db
      .select({ userId: teamMember.userId })
      .from(teamMember)
      .where(inArray(teamMember.teamId, teamIds));
    for (const row of rows) readers.add(row.userId);
  }

  return [...readers];
}

/* ------------------------------------------------------------------ sending */

/** A push service saying this browser is gone for good, not just unreachable. */
const GONE = new Set([404, 410]);

/** How many soft failures a subscription is given before it is dropped. */
const GIVE_UP_AFTER = 8;

async function sendTo(
  row: { id: string; endpoint: string; p256dh: string; auth: string; failures: number },
  payload: PushPayload,
) {
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 },
    );
    if (row.failures > 0) {
      await db
        .update(pushSubscription)
        .set({ failures: 0, lastSeenAt: new Date() })
        .where(eq(pushSubscription.id, row.id));
    }
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode ?? 0;

    // Unsubscribed, or the browser profile is gone. Keeping the row would mean
    // failing this call again on every message for the rest of time.
    if (GONE.has(status)) {
      await db.delete(pushSubscription).where(eq(pushSubscription.id, row.id));
      return;
    }

    const failures = row.failures + 1;
    if (failures >= GIVE_UP_AFTER) {
      await db.delete(pushSubscription).where(eq(pushSubscription.id, row.id));
      return;
    }
    await db.update(pushSubscription).set({ failures }).where(eq(pushSubscription.id, row.id));
  }
}

/** Sends one notification to every browser a person has registered. */
export async function pushToUsers(userIds: string[], payload: PushPayload) {
  if (!ready() || userIds.length === 0) return 0;

  const rows = await db
    .select()
    .from(pushSubscription)
    .where(inArray(pushSubscription.userId, userIds));
  if (rows.length === 0) return 0;

  await Promise.all(rows.map((row) => sendTo(row, payload)));
  return rows.length;
}

/**
 * Tells everybody who may read this mailbox that something arrived in it.
 *
 * Call it without awaiting. A push service on the other side of the world is
 * not something an inbound message should wait for.
 */
export async function announceToMailbox(
  orgId: string,
  mailboxId: string,
  payload: PushPayload,
): Promise<void> {
  if (!ready()) return;
  try {
    const readers = await readersOf(orgId, mailboxId);
    await pushToUsers(readers, payload);
  } catch {
    // A notification nobody receives is a smaller problem than a delivery
    // that fails because of one.
  }
}
