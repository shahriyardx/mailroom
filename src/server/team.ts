"use server";

import { db } from "@/db";
import {
  accessGrant,
  domain as domainTable,
  invitation,
  mailbox as mailboxTable,
  member,
  organization,
  team,
  teamMember,
  user,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { type Role, requireAccess } from "./access";
import {
  freshExpiry,
  inviteLink,
  makeInviteToken,
  newInvitationId,
  sendInvitationEmail,
} from "./invitations";
import { assertCan, can } from "./permissions";

export interface PersonRow {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
  teams: { id: string; name: string; isRoot: boolean; lead: boolean }[];
}

export async function listPeople() {
  const access = await requireAccess();
  // A lead needs to see the people they can put in their team.
  if (!can(access, "member:manage") && access.leadsTeamIds.length === 0) {
    assertCan(access, "member:manage");
  }

  const members = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      role: member.role,
      joinedAt: member.createdAt,
      name: user.name,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, access.orgId));

  const memberships = await db
    .select({
      userId: teamMember.userId,
      id: team.id,
      name: team.name,
      isRoot: team.isRoot,
      role: teamMember.role,
    })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(eq(team.organizationId, access.orgId));

  const people: PersonRow[] = members.map((row) => ({
    ...row,
    role: row.role as Role,
    teams: memberships
      .filter((entry) => entry.userId === row.userId)
      .map(({ id, name, isRoot, role }) => ({ id, name, isRoot, lead: role === "lead" })),
  }));

  const pending = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.organizationId, access.orgId), eq(invitation.status, "pending")));

  const teams = await db.select().from(team).where(eq(team.organizationId, access.orgId));

  return { people, pending, teams, me: access };
}

export async function inviteMemberAction(
  email: string,
  role: Role,
  teamId: string | null,
  fromMailboxId?: string | null,
) {
  const access = await requireAccess();
  assertCan(access, "member:manage");

  const address = email.trim().toLowerCase();
  if (!address.includes("@")) return { ok: false as const, error: "That is not an email address" };

  // Only an owner can make another owner, or the role would be a way around
  // every restriction placed on an admin.
  if (role === "owner" && access.role !== "owner") {
    return { ok: false as const, error: "Only the owner can invite another owner" };
  }

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, address))
    .limit(1);
  if (existing) return { ok: false as const, error: "That person is already here" };

  const token = makeInviteToken();
  await db.insert(invitation).values({
    id: newInvitationId(),
    organizationId: access.orgId,
    email: address,
    role,
    teamId,
    status: "pending",
    tokenHash: token.hash,
    fromMailboxId: fromMailboxId || null,
    expiresAt: freshExpiry(),
    inviterId: access.userId,
  });

  const [company] = await db.select().from(organization).where(eq(organization.id, access.orgId));

  const delivery = await sendInvitationEmail({
    orgId: access.orgId,
    email: address,
    secret: token.secret,
    inviterName: access.name || access.email,
    companyName: company?.name ?? "Mailroom",
    fromMailboxId,
  });

  revalidatePath("/settings/people");
  // The link comes back either way, so an invitation is never stuck behind a
  // mail problem: it can be handed over directly.
  return {
    ok: true as const,
    email: address,
    link: inviteLink(token.secret),
    sent: delivery.sent,
    reason: delivery.sent ? undefined : delivery.reason,
  };
}

export async function cancelInvitationAction(invitationId: string) {
  const access = await requireAccess();
  assertCan(access, "member:manage");

  await db
    .delete(invitation)
    .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, access.orgId)));
  revalidatePath("/settings/people");
}

export async function setMemberRoleAction(memberId: string, role: Role) {
  const access = await requireAccess();
  assertCan(access, "member:manage");

  const [target] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, access.orgId)));
  if (!target) return { ok: false as const, error: "No such person" };

  // Nobody changes their own role. Demoting yourself is how an instance ends
  // up with nobody able to run it, and raising yourself would make every
  // restriction on an admin optional.
  if (target.userId === access.userId) {
    return { ok: false as const, error: "You cannot change your own role" };
  }

  if (target.role === "owner" || role === "owner") {
    if (access.role !== "owner") {
      return { ok: false as const, error: "Only the owner can change who owns this instance" };
    }
  }

  // An instance with nobody able to add a domain is an instance nobody can
  // run, so the last owner cannot demote themselves.
  if (target.role === "owner" && role !== "owner") {
    const owners = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, access.orgId), eq(member.role, "owner")));
    if (owners.length <= 1) {
      return { ok: false as const, error: "Make someone else an owner first" };
    }
  }

  await db.update(member).set({ role }).where(eq(member.id, memberId));
  revalidatePath("/settings/people");
  return { ok: true as const };
}

export async function removeMemberAction(memberId: string) {
  const access = await requireAccess();
  assertCan(access, "member:manage");

  const [target] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, access.orgId)));
  if (!target) return { ok: false as const, error: "No such person" };

  if (target.role === "owner") {
    return { ok: false as const, error: "An owner cannot be removed. Change their role first." };
  }
  if (target.userId === access.userId) {
    return { ok: false as const, error: "You cannot remove yourself" };
  }

  await db.delete(teamMember).where(eq(teamMember.userId, target.userId));
  await db.delete(member).where(eq(member.id, memberId));
  revalidatePath("/settings/people");
  return { ok: true as const };
}

export async function createTeamAction(name: string) {
  const access = await requireAccess();
  assertCan(access, "team:manage");

  const trimmed = name.trim();
  if (!trimmed) return { ok: false as const, error: "Give the team a name" };

  const id = newId("team");
  await db.insert(team).values({ id, name: trimmed, organizationId: access.orgId });
  revalidatePath("/settings/people");
  return { ok: true as const, id };
}

export async function deleteTeamAction(teamId: string) {
  const access = await requireAccess();
  assertCan(access, "team:manage");

  const [target] = await db
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, access.orgId)));
  if (!target) return { ok: false as const, error: "No such team" };
  if (target.isRoot) {
    return { ok: false as const, error: "The root team cannot be deleted" };
  }

  await db.delete(team).where(eq(team.id, teamId));
  revalidatePath("/settings/people");
  return { ok: true as const };
}

export async function setTeamMembershipAction(teamId: string, userId: string, member_: boolean) {
  const access = await requireAccess();

  const [target] = await db
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, access.orgId)));
  if (!target) return { ok: false as const, error: "No such team" };

  // Leading a team means running its people. It does not mean deciding what
  // the team reaches, which stays with the people who administer the
  // instance — otherwise a lead could grant their own team anything.
  if (!can(access, "team:manage") && !access.leadsTeamIds.includes(teamId)) {
    return { ok: false as const, error: "You do not lead that team" };
  }

  // The root team reaches every mailbox without a grant, so who is in it is
  // the owner's decision. An admin could otherwise put themselves in it and
  // read everything.
  if (target.isRoot && access.role !== "owner") {
    return { ok: false as const, error: "Only the owner decides who is in the root team" };
  }

  if (member_) {
    await db
      .insert(teamMember)
      .values({ id: newId("tmem"), teamId, userId })
      .onConflictDoNothing();
    await recountTeam(teamId);
  } else {
    // Emptying the root team would leave nobody who reaches everything.
    if (target.isRoot) {
      const others = await db
        .select({ id: teamMember.id })
        .from(teamMember)
        .where(and(eq(teamMember.teamId, teamId), ne(teamMember.userId, userId)));
      if (others.length === 0) {
        return { ok: false as const, error: "The root team cannot be left empty" };
      }
    }
    await db
      .delete(teamMember)
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));
    await recountTeam(teamId);
  }

  revalidatePath("/settings/people");
  return { ok: true as const };
}

/** Keeps the count better-auth stores on a team honest. */
async function recountTeam(teamId: string) {
  const rows = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(eq(teamMember.teamId, teamId));
  await db.update(team).set({ memberCount: rows.length }).where(eq(team.id, teamId));
}

/** The company this instance belongs to, and what it is called. */
export async function getCompany() {
  const access = await requireAccess();
  const [row] = await db.select().from(organization).where(eq(organization.id, access.orgId));
  return { company: row ?? null, canRename: can(access, "instance:manage") };
}

export async function renameCompanyAction(name: string) {
  const access = await requireAccess();
  assertCan(access, "instance:manage");

  const trimmed = name.trim();
  if (trimmed.length < 2) return { ok: false as const, error: "Give the company a name" };

  await db.update(organization).set({ name: trimmed }).where(eq(organization.id, access.orgId));

  revalidatePath("/settings", "layout");
  return { ok: true as const };
}

/* -------------------------------------------------------------------------- */
/* Access grants                                                              */
/* -------------------------------------------------------------------------- */

export interface GrantRow {
  id: string;
  subjectType: "team" | "member";
  subjectId: string;
  subjectName: string;
  /** Set for a person, so two similar names can be told apart. */
  subjectEmail?: string;
  resourceType: "domain" | "mailbox";
  resourceId: string;
  resourceName: string;
  canRead: boolean;
  canSend: boolean;
  canManage: boolean;
  canCreateMailbox: boolean;
}

export async function listGrants() {
  const access = await requireAccess();
  assertCan(access, "access:manage");

  const [rows, teams, members, domains, mailboxes] = await Promise.all([
    db.select().from(accessGrant).where(eq(accessGrant.organizationId, access.orgId)),
    db.select().from(team).where(eq(team.organizationId, access.orgId)),
    db
      .select({ id: member.id, name: user.name, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, access.orgId)),
    db.select().from(domainTable).where(eq(domainTable.organizationId, access.orgId)),
    db.select().from(mailboxTable).where(eq(mailboxTable.organizationId, access.orgId)),
  ]);

  const nameOf = (row: (typeof rows)[number]) => {
    if (row.subjectType === "team") {
      return teams.find((entry) => entry.id === row.subjectId)?.name ?? "a deleted team";
    }
    const person = members.find((entry) => entry.id === row.subjectId);
    return person ? person.name || person.email : "a removed person";
  };

  const resourceOf = (row: (typeof rows)[number]) => {
    if (row.resourceType === "domain") {
      return domains.find((entry) => entry.id === row.resourceId)?.name ?? "a deleted domain";
    }
    return mailboxes.find((entry) => entry.id === row.resourceId)?.address ?? "a deleted mailbox";
  };

  const emailOf = (row: (typeof rows)[number]) =>
    row.subjectType === "member"
      ? members.find((entry) => entry.id === row.subjectId)?.email
      : undefined;

  const grants: GrantRow[] = rows.map((row) => ({
    id: row.id,
    subjectType: row.subjectType as "team" | "member",
    subjectId: row.subjectId,
    subjectName: nameOf(row),
    subjectEmail: emailOf(row),
    resourceType: row.resourceType as "domain" | "mailbox",
    resourceId: row.resourceId,
    resourceName: resourceOf(row),
    canRead: row.canRead,
    canSend: row.canSend,
    canManage: row.canManage,
    canCreateMailbox: row.canCreateMailbox,
  }));

  return {
    grants,
    teams: teams.map(({ id, name, isRoot }) => ({ id, name, isRoot })),
    members: members.map(({ id, name, email }) => ({ id, name: name || email, email })),
    domains: domains.map(({ id, name }) => ({ id, name })),
    mailboxes: mailboxes.map(({ id, address }) => ({ id, address })),
  };
}

export interface GrantInput {
  subjectType: "team" | "member";
  subjectId: string;
  resourceType: "domain" | "mailbox";
  /** One or many. Granting several at once writes one grant for each. */
  resourceIds: string[];
  canSend: boolean;
  canManage: boolean;
  /** Only meaningful on a domain grant. */
  canCreateMailbox?: boolean;
}

/** Grants, or changes, one subject's access to any number of resources. */
export async function setGrantsAction(input: GrantInput) {
  const access = await requireAccess();
  assertCan(access, "access:manage");

  for (const resourceId of input.resourceIds) {
    await writeGrant(access.orgId, {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      resourceType: input.resourceType,
      resourceId,
      canRead: true,
      canSend: input.canSend,
      canManage: input.canManage,
      canCreateMailbox: input.resourceType === "domain" && input.canCreateMailbox === true,
    });
  }

  revalidatePath("/settings/access");
  revalidatePath("/mail", "layout");
  return { ok: true as const, count: input.resourceIds.length };
}

export async function setGrantAction(input: {
  subjectType: "team" | "member";
  subjectId: string;
  resourceType: "domain" | "mailbox";
  resourceId: string;
  canRead: boolean;
  canSend: boolean;
  canManage: boolean;
  canCreateMailbox?: boolean;
}) {
  const access = await requireAccess();
  assertCan(access, "access:manage");

  // Nothing granted is the same as no grant at all, so it is removed rather
  // than left as a row that says a person may do nothing.
  if (!input.canRead && !input.canSend && !input.canManage && !input.canCreateMailbox) {
    await db
      .delete(accessGrant)
      .where(
        and(
          eq(accessGrant.organizationId, access.orgId),
          eq(accessGrant.subjectType, input.subjectType),
          eq(accessGrant.subjectId, input.subjectId),
          eq(accessGrant.resourceType, input.resourceType),
          eq(accessGrant.resourceId, input.resourceId),
        ),
      );
    revalidatePath("/settings/access");
    return { ok: true as const };
  }

  await writeGrant(access.orgId, {
    ...input,
    canCreateMailbox: input.resourceType === "domain" && input.canCreateMailbox === true,
  });

  revalidatePath("/settings/access");
  revalidatePath("/mail", "layout");
  return { ok: true as const };
}

async function writeGrant(
  orgId: string,
  grant: {
    subjectType: string;
    subjectId: string;
    resourceType: string;
    resourceId: string;
    canRead: boolean;
    canSend: boolean;
    canManage: boolean;
    canCreateMailbox: boolean;
  },
) {
  // Sending, managing or adding to something you cannot see would mean
  // nothing, so reading comes with every grant.
  const canRead = grant.canRead || grant.canSend || grant.canManage || grant.canCreateMailbox;

  await db
    .insert(accessGrant)
    .values({ id: newId("grant"), organizationId: orgId, ...grant, canRead })
    .onConflictDoUpdate({
      target: [
        accessGrant.subjectType,
        accessGrant.subjectId,
        accessGrant.resourceType,
        accessGrant.resourceId,
      ],
      set: {
        canRead,
        canSend: grant.canSend,
        canManage: grant.canManage,
        canCreateMailbox: grant.canCreateMailbox,
      },
    });
}

export async function removeGrantAction(grantId: string) {
  const access = await requireAccess();
  assertCan(access, "access:manage");

  await db
    .delete(accessGrant)
    .where(and(eq(accessGrant.id, grantId), eq(accessGrant.organizationId, access.orgId)));
  revalidatePath("/settings/access");
  revalidatePath("/mail", "layout");
}

/** Issues a new link for an invitation that was never opened. */
export async function resendInvitationAction(invitationId: string) {
  const access = await requireAccess();
  assertCan(access, "member:manage");

  const [row] = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, access.orgId)));
  if (!row) return { ok: false as const, error: "No such invitation" };
  if (row.status === "accepted") return { ok: false as const, error: "That person already joined" };

  // A fresh secret, so a link that leaked earlier stops working.
  const token = makeInviteToken();
  await db
    .update(invitation)
    .set({ tokenHash: token.hash, status: "pending", expiresAt: freshExpiry() })
    .where(eq(invitation.id, row.id));

  const [company] = await db.select().from(organization).where(eq(organization.id, access.orgId));

  const delivery = await sendInvitationEmail({
    orgId: access.orgId,
    email: row.email,
    secret: token.secret,
    inviterName: access.name || access.email,
    companyName: company?.name ?? "Mailroom",
    fromMailboxId: row.fromMailboxId,
  });

  revalidatePath("/settings/people");
  return {
    ok: true as const,
    link: inviteLink(token.secret),
    sent: delivery.sent,
    reason: delivery.sent ? undefined : delivery.reason,
  };
}

/** Makes someone a lead of a team, or an ordinary member of it again. */
export async function setTeamRoleAction(teamId: string, userId: string, lead: boolean) {
  const access = await requireAccess();

  const [target] = await db
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, access.orgId)));
  if (!target) return { ok: false as const, error: "No such team" };

  if (!can(access, "team:manage") && !access.leadsTeamIds.includes(teamId)) {
    return { ok: false as const, error: "You do not lead that team" };
  }

  // A lead cannot step themselves down: a team is left without one that way,
  // and the same reasoning applies as to an owner demoting themselves.
  if (userId === access.userId && !lead && !can(access, "team:manage")) {
    return { ok: false as const, error: "Ask an admin to change your own role in a team" };
  }

  await db
    .update(teamMember)
    .set({ role: lead ? "lead" : "member" })
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));

  revalidatePath("/settings/people");
  return { ok: true as const };
}
