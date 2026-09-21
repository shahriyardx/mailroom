import "server-only";

import { db } from "@/db";
import { accessGrant, mailbox } from "@/db/schema";
import { newId } from "@/lib/utils";
import { and, eq, inArray, or } from "drizzle-orm";
import type { Access } from "./access";

export interface MailboxRights {
  read: boolean;
  send: boolean;
  manage: boolean;
}

const NONE: MailboxRights = { read: false, send: false, manage: false };
const ALL: MailboxRights = { read: true, send: true, manage: true };

/**
 * What this person may do with each mailbox, by mailbox id.
 *
 * Rights are the union of everything granted to them and to every team they
 * are in, so being in two teams can only ever add. A grant on a domain covers
 * every mailbox on it, including ones created later, which is the point of
 * granting a domain rather than listing its mailboxes.
 */
export async function mailboxRights(access: Access): Promise<Map<string, MailboxRights>> {
  const boxes = await db
    .select({ id: mailbox.id, domain: mailbox.domain, domainId: mailbox.domainId })
    .from(mailbox)
    .where(eq(mailbox.organizationId, access.orgId));

  // The root team, and whoever runs the instance, reach everything.
  if (access.isRoot) {
    return new Map(boxes.map((box) => [box.id, ALL]));
  }

  const subjects = [access.memberId, ...access.teamIds];
  if (subjects.length === 0) return new Map();

  const grants = await db
    .select()
    .from(accessGrant)
    .where(
      and(
        eq(accessGrant.organizationId, access.orgId),
        inArray(accessGrant.subjectId, subjects),
        or(eq(accessGrant.subjectType, "member"), eq(accessGrant.subjectType, "team")),
      ),
    );

  const rights = new Map<string, MailboxRights>();
  const add = (id: string, grant: { canRead: boolean; canSend: boolean; canManage: boolean }) => {
    const current = rights.get(id) ?? NONE;
    rights.set(id, {
      read: current.read || grant.canRead,
      send: current.send || grant.canSend,
      manage: current.manage || grant.canManage,
    });
  };

  for (const grant of grants) {
    if (grant.resourceType === "mailbox") {
      if (boxes.some((box) => box.id === grant.resourceId)) add(grant.resourceId, grant);
      continue;
    }
    if (grant.resourceType === "domain") {
      for (const box of boxes) {
        if (box.domainId === grant.resourceId) add(box.id, grant);
      }
    }
  }

  return rights;
}

/** The mailboxes this person may see. Everything else is scoped from here. */
export async function readableMailboxIds(access: Access) {
  const rights = await mailboxRights(access);
  return [...rights.entries()].filter(([, right]) => right.read).map(([id]) => id);
}

/**
 * The domains this person may create a mailbox on. Only a domain grant can
 * carry the right, since a mailbox grant says nothing about its domain.
 */
export async function creatableDomainIds(access: Access) {
  if (access.isRoot) return "all" as const;

  const subjects = [access.memberId, ...access.teamIds];
  if (subjects.length === 0) return [];

  const rows = await db
    .select({ resourceId: accessGrant.resourceId })
    .from(accessGrant)
    .where(
      and(
        eq(accessGrant.organizationId, access.orgId),
        inArray(accessGrant.subjectId, subjects),
        eq(accessGrant.resourceType, "domain"),
        eq(accessGrant.canCreateMailbox, true),
      ),
    );

  return rows.map((row) => row.resourceId);
}

/** The mailboxes this person may send as. What the composer may offer. */
export async function sendableMailboxIds(access: Access) {
  const rights = await mailboxRights(access);
  return [...rights.entries()].filter(([, right]) => right.send).map(([id]) => id);
}

/** Throws unless the person may send as this mailbox. */
export async function assertCanSendAs(access: Access, mailboxId: string) {
  const rights = await mailboxRights(access);
  if (!rights.get(mailboxId)?.send) {
    throw new Error("You cannot send as that mailbox");
  }
}

/** Throws unless the person may change this mailbox. */
export async function assertCanManage(access: Access, mailboxId: string) {
  const rights = await mailboxRights(access);
  if (!rights.get(mailboxId)?.manage) {
    throw new Error("You cannot change that mailbox");
  }
}

/** Throws unless the person may read this mailbox. */
export async function assertCanRead(access: Access, mailboxId: string) {
  const rights = await mailboxRights(access);
  if (!rights.get(mailboxId)?.read) {
    throw new Error("You do not have access to that mailbox");
  }
}

/**
 * The mailboxes this person may change, and the domains they may add to.
 * A grant can carry either, so the mailboxes screen is not only for
 * administrators.
 */
export async function mailboxAdministration(access: Access) {
  const [rights, creatable] = await Promise.all([
    mailboxRights(access),
    creatableDomainIds(access),
  ]);

  return {
    readable: [...rights.entries()].filter(([, r]) => r.read).map(([id]) => id),
    manageable: [...rights.entries()].filter(([, r]) => r.manage).map(([id]) => id),
    creatable,
    get any() {
      return (
        this.readable.length > 0 ||
        this.manageable.length > 0 ||
        this.creatable === "all" ||
        this.creatable.length > 0
      );
    },
  };
}

/**
 * Gives whoever made a mailbox the run of it.
 *
 * Someone adding a mailbox under a domain grant would otherwise be left
 * unable to set its signature unless that same grant happened to say manage,
 * which makes for the odd position of creating something you cannot
 * configure. Administrators need no grant, so they get none.
 */
export async function grantCreatorAccess(orgId: string, memberId: string, mailboxId: string) {
  await db
    .insert(accessGrant)
    .values({
      id: newId("grant"),
      organizationId: orgId,
      subjectType: "member",
      subjectId: memberId,
      resourceType: "mailbox",
      resourceId: mailboxId,
      canRead: true,
      canSend: true,
      canManage: true,
    })
    .onConflictDoNothing();
}
