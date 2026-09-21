"use server";

import { db } from "@/db";
import { invitation, member, team, teamMember, user } from "@/db/schema";
import { newId } from "@/lib/utils";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { type Role, requireAccess } from "./access";
import { assertCan } from "./permissions";

const INVITE_DAYS = 14;

export interface PersonRow {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
  teams: { id: string; name: string; isRoot: boolean }[];
}

export async function listPeople() {
  const access = await requireAccess();

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
    .select({ userId: teamMember.userId, id: team.id, name: team.name, isRoot: team.isRoot })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(eq(team.organizationId, access.orgId));

  const people: PersonRow[] = members.map((row) => ({
    ...row,
    role: row.role as Role,
    teams: memberships
      .filter((entry) => entry.userId === row.userId)
      .map(({ id, name, isRoot }) => ({ id, name, isRoot })),
  }));

  const pending = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.organizationId, access.orgId), eq(invitation.status, "pending")));

  const teams = await db.select().from(team).where(eq(team.organizationId, access.orgId));

  return { people, pending, teams, me: access };
}

export async function inviteMemberAction(email: string, role: Role, teamId: string | null) {
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

  await db.insert(invitation).values({
    id: newId("inv"),
    organizationId: access.orgId,
    email: address,
    role,
    teamId,
    status: "pending",
    expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
    inviterId: access.userId,
  });

  revalidatePath("/settings/people");
  return { ok: true as const, email: address };
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
  assertCan(access, "team:manage");

  const [target] = await db
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, access.orgId)));
  if (!target) return { ok: false as const, error: "No such team" };

  if (member_) {
    await db
      .insert(teamMember)
      .values({ id: newId("tmem"), teamId, userId })
      .onConflictDoNothing();
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
  }

  revalidatePath("/settings/people");
  return { ok: true as const };
}
