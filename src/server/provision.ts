import "server-only";

import { db } from "@/db";
import { invitation, member, organization, team, teamMember } from "@/db/schema";
import { newId } from "@/lib/utils";
import { and, eq } from "drizzle-orm";

const ROOT_TEAM = "Root";

/**
 * Settles a newly created account into the instance.
 *
 * The first person to arrive creates the company and owns it. Everyone after
 * that must have been invited, and is placed in whatever team the invitation
 * named. Nobody is given a membership merely for having signed in, because a
 * membership is what grants sight of the company's mail.
 */
export async function provisionUser(user: { id: string; email: string; name?: string | null }) {
  const [existing] = await db.select().from(organization).limit(1);

  if (!existing) {
    await createInstance(user);
    return;
  }

  await acceptInvitation(existing.id, user);
}

async function createInstance(user: { id: string; email: string; name?: string | null }) {
  const orgId = newId("org");
  const teamId = newId("team");

  // Named after the product, not after the person who installed it. The
  // company name is written into every invitation, and one named after its
  // owner reads as "Alice invited you to Alice". The owner renames it under
  // Settings -> Account.
  await db.insert(organization).values({
    id: orgId,
    name: "Mailroom",
    slug: "mailroom",
  });

  // The root team reaches every domain and mailbox without a grant.
  await db.insert(team).values({
    id: teamId,
    name: ROOT_TEAM,
    organizationId: orgId,
    isRoot: true,
  });

  await db.insert(member).values({
    id: newId("mem"),
    organizationId: orgId,
    userId: user.id,
    role: "owner",
  });

  await db.insert(teamMember).values({
    id: newId("tmem"),
    teamId,
    userId: user.id,
  });
}

async function acceptInvitation(
  orgId: string,
  user: { id: string; email: string; name?: string | null },
) {
  const [pending] = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.email, user.email.toLowerCase()), eq(invitation.status, "pending")))
    .limit(1);

  // Without an invitation there is no membership, and without a membership
  // the app shows nothing. Sign-up is refused before reaching here anyway.
  if (!pending) return;

  await db.insert(member).values({
    id: newId("mem"),
    organizationId: orgId,
    userId: user.id,
    role: pending.role ?? "member",
  });

  if (pending.teamId) {
    await db
      .insert(teamMember)
      .values({ id: newId("tmem"), teamId: pending.teamId, userId: user.id })
      .onConflictDoNothing();
  }

  await db.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, pending.id));
}
