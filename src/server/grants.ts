import "server-only";

import { db } from "@/db";
import { accessGrant, mailbox } from "@/db/schema";
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

/** Throws unless the person may send as this mailbox. */
export async function assertCanSendAs(access: Access, mailboxId: string) {
  const rights = await mailboxRights(access);
  if (!rights.get(mailboxId)?.send) {
    throw new Error("You cannot send as that mailbox");
  }
}

/** Throws unless the person may read this mailbox. */
export async function assertCanRead(access: Access, mailboxId: string) {
  const rights = await mailboxRights(access);
  if (!rights.get(mailboxId)?.read) {
    throw new Error("You do not have access to that mailbox");
  }
}
