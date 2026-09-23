import "server-only";

import { db } from "@/db";
import {
  accessGrant,
  automation,
  automationNode,
  broadcast,
  listMember,
  mailingList,
  segment,
} from "@/db/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import type { Access } from "./access";
import { can } from "./permissions";

/**
 * Who may touch which audience.
 *
 * The campaigns side had no access control of its own: every screen was
 * gated on being an administrator, so there was no way to let the person who
 * writes the newsletter near the newsletter without handing them the
 * instance. This is the same shape as the mailbox grants on the mail side,
 * against the thing that matters here — a list of real people who agreed to
 * hear from you, which is the most sensitive data in the product.
 *
 * Two resources, because the useful grants are "this list" and "all of them":
 *
 *   list   one named list
 *   lists  every list, including ones made later, with "*" for an id
 *
 * And three rights, which mean for a list what they mean for a mailbox:
 *
 *   read    see the list, who is on it, and how a campaign to it did
 *   send    aim a campaign or an automation at it
 *   manage  edit it, add and remove people, export it
 *
 * Manage over *every* list is also the right to make a new one: there is no
 * meaningful difference between running the whole collection and adding to it.
 */

export interface ListRights {
  read: boolean;
  send: boolean;
  manage: boolean;
}

const NONE: ListRights = { read: false, send: false, manage: false };
const ALL: ListRights = { read: true, send: true, manage: true };

/**
 * Everything this person may reach on the campaigns side.
 *
 * Whoever runs the instance reaches all of it without a grant, the way they
 * do everywhere else. An administrator does too: unlike a mailbox, a mailing
 * list is company property rather than somebody's correspondence, and an
 * instance where the administrator cannot open the list they are asked about
 * is an instance with a support problem.
 */
export async function campaignReach(access: Access) {
  const lists = await db
    .select({ id: mailingList.id })
    .from(mailingList)
    .where(eq(mailingList.organizationId, access.orgId));

  if (access.isRoot || can(access, "rules:manage")) {
    return {
      rights: new Map(lists.map((list) => [list.id, ALL])),
      /** Every list there is, and every list there will be. */
      everything: true,
      canCreate: true,
    };
  }

  const subjects = [access.memberId, ...access.teamIds];
  if (subjects.length === 0) {
    return { rights: new Map<string, ListRights>(), everything: false, canCreate: false };
  }

  const grants = await db
    .select()
    .from(accessGrant)
    .where(
      and(
        eq(accessGrant.organizationId, access.orgId),
        inArray(accessGrant.subjectId, subjects),
        or(eq(accessGrant.resourceType, "list"), eq(accessGrant.resourceType, "lists")),
      ),
    );

  const rights = new Map<string, ListRights>();
  let canCreate = false;

  const add = (id: string, grant: { canRead: boolean; canSend: boolean; canManage: boolean }) => {
    const current = rights.get(id) ?? NONE;
    rights.set(id, {
      read: current.read || grant.canRead,
      send: current.send || grant.canSend,
      manage: current.manage || grant.canManage,
    });
  };

  for (const grant of grants) {
    if (grant.resourceType === "lists") {
      // Every list, including the ones that do not exist yet.
      for (const list of lists) add(list.id, grant);
      if (grant.canManage) canCreate = true;
      continue;
    }
    if (lists.some((list) => list.id === grant.resourceId)) add(grant.resourceId, grant);
  }

  return { rights, everything: false, canCreate };
}

/** What this person may do with one list. */
export async function listRights(access: Access, listId: string): Promise<ListRights> {
  const reach = await campaignReach(access);
  return reach.rights.get(listId) ?? NONE;
}

/**
 * The lists this person may see, or "all" when there is nothing to filter by.
 *
 * "all" rather than a list of ids so a query can skip the filter entirely,
 * and so a grant on every list keeps covering lists made after it.
 */
export async function readableLists(access: Access): Promise<"all" | string[]> {
  const reach = await campaignReach(access);
  if (reach.everything) return "all";
  return [...reach.rights.entries()].filter(([, right]) => right.read).map(([id]) => id);
}

/** Whether the campaigns view has anything in it for this person. */
export async function hasCampaignAccess(access: Access) {
  const reach = await campaignReach(access);
  return reach.everything || reach.canCreate || reach.rights.size > 0;
}

export async function assertCanReadList(access: Access, listId: string) {
  if (!(await listRights(access, listId)).read) {
    throw new Error("You do not have access to that list");
  }
}

export async function assertCanManageList(access: Access, listId: string) {
  if (!(await listRights(access, listId)).manage) {
    throw new Error("You cannot change that list");
  }
}

/**
 * Throws unless the person may aim a campaign at this list.
 *
 * A campaign with no list yet is a draft nobody can send, so an empty list id
 * is allowed through: `startBroadcast` refuses on its own, and stopping a
 * draft from being written would stop the screen from working at all.
 */
export async function assertCanSendToList(access: Access, listId: string | null | undefined) {
  if (!listId) return;
  if (!(await listRights(access, listId)).send) {
    throw new Error("You cannot send to that list");
  }
}

export async function assertCanCreateList(access: Access) {
  const reach = await campaignReach(access);
  if (!reach.canCreate) {
    throw new Error("You cannot create a list");
  }
}

/** The same check, against the list a campaign is aimed at. */
export async function assertCanSendBroadcast(access: Access, broadcastId: string) {
  const [row] = await db
    .select({ listId: broadcast.listId })
    .from(broadcast)
    .where(and(eq(broadcast.id, broadcastId), eq(broadcast.organizationId, access.orgId)))
    .limit(1);
  if (!row) throw new Error("No such campaign");
  await assertCanSendToList(access, row.listId);
}

/** And against the list an automation runs on. */
export async function assertCanRunAutomation(access: Access, automationId: string) {
  const [row] = await db
    .select({ listId: automation.listId })
    .from(automation)
    .where(and(eq(automation.id, automationId), eq(automation.organizationId, access.orgId)))
    .limit(1);
  if (!row) throw new Error("No such automation");
  await assertCanSendToList(access, row.listId);
}

/** The list a segment describes, for the actions that are given only its id. */
export async function listOfSegment(orgId: string, segmentId: string) {
  const [row] = await db
    .select({ listId: segment.listId })
    .from(segment)
    .where(and(eq(segment.id, segmentId), eq(segment.organizationId, orgId)))
    .limit(1);
  return row?.listId ?? null;
}

/** The automation a step belongs to, for the same reason. */
export async function automationOfNode(orgId: string, nodeId: string) {
  // A step carries no company of its own; the automation above it does.
  const [row] = await db
    .select({ automationId: automationNode.automationId })
    .from(automationNode)
    .innerJoin(automation, eq(automation.id, automationNode.automationId))
    .where(and(eq(automationNode.id, nodeId), eq(automation.organizationId, orgId)))
    .limit(1);
  return row?.automationId ?? null;
}

/** The list a member row belongs to, for the actions that are given only a person. */
export async function listOfMember(orgId: string, memberId: string) {
  const [row] = await db
    .select({ listId: listMember.listId })
    .from(listMember)
    .where(and(eq(listMember.id, memberId), eq(listMember.organizationId, orgId)))
    .limit(1);
  return row?.listId ?? null;
}
