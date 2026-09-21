import "server-only";

import { db } from "@/db";
import { member, organization, team, teamMember } from "@/db/schema";
import { getSession } from "@/lib/session";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

export type Role = "owner" | "admin" | "member";

/**
 * Who is asking, and what they are asking on behalf of. Every query that
 * touches company data goes through this rather than reading the session
 * directly, so there is one place where scoping is decided.
 */
export interface Access {
  userId: string;
  name: string;
  email: string;
  /** The company. One per instance. */
  orgId: string;
  memberId: string;
  role: Role;
  teamIds: string[];
  /** The teams this person leads, which lets them run those teams' people. */
  leadsTeamIds: string[];
  /** In the root team, which reaches everything without a grant. */
  isRoot: boolean;
}

export function canManageOrg(access: Access) {
  return access.role === "owner" || access.role === "admin";
}

/** The company this instance belongs to, or null before anyone has signed in. */
export async function currentOrganization() {
  const [row] = await db.select().from(organization).limit(1);
  return row ?? null;
}

export async function rootTeam(orgId: string) {
  const [row] = await db
    .select()
    .from(team)
    .where(and(eq(team.organizationId, orgId), eq(team.isRoot, true)))
    .limit(1);
  return row ?? null;
}

/**
 * Resolves the signed-in person to their membership. Returns null rather than
 * redirecting, for the callers that have somewhere else to go.
 */
export async function getAccess(): Promise<Access | null> {
  const session = await getSession();
  if (!session?.user) return null;

  const [row] = await db.select().from(member).where(eq(member.userId, session.user.id)).limit(1);
  if (!row) return null;

  const teams = await db
    .select({ id: team.id, isRoot: team.isRoot, role: teamMember.role })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(eq(teamMember.userId, session.user.id));

  return {
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    orgId: row.organizationId,
    memberId: row.id,
    role: row.role as Role,
    teamIds: teams.map((entry) => entry.id),
    leadsTeamIds: teams.filter((entry) => entry.role === "lead").map((entry) => entry.id),
    /*
     * Reaching every mailbox belongs to the owner and to the root team they
     * control. An admin runs the place — people, teams, mailboxes, keys —
     * without thereby being able to read everybody's mail, which is a
     * different thing and not implied by the first.
     */
    isRoot: teams.some((entry) => entry.isRoot) || row.role === "owner",
  };
}

/** The same, for the pages and actions that require a signed-in member. */
export async function requireAccess(): Promise<Access> {
  const access = await getAccess();
  if (!access) redirect("/sign-in");
  return access;
}

/** Refuses anything a plain member may not do. */
export async function requireOrgManager(): Promise<Access> {
  const access = await requireAccess();
  if (!canManageOrg(access)) {
    throw new Error("Only an owner or an admin can change this");
  }
  return access;
}
