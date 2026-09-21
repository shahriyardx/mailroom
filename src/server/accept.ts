"use server";

import { db } from "@/db";
import { invitation, member, teamMember } from "@/db/schema";
import { auth } from "@/lib/auth";
import { newId } from "@/lib/utils";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { beginAccepting, invitationForToken } from "./invitations";

/**
 * Turns an invitation link into an account.
 *
 * The invitation is moved to "accepting" first, which is the only state that
 * lets an account be created for that address. Everything else — the account,
 * the membership, the team — follows from the link having been presented, so
 * knowing that an address was invited gets nobody in.
 */
export async function acceptInvitationAction(input: {
  token: string;
  name: string;
  password: string;
}) {
  const found = await invitationForToken(input.token);
  if (!found) return { ok: false as const, error: "This link is no longer good" };

  const name = input.name.trim();
  if (name.length < 2) return { ok: false as const, error: "Tell us your name" };
  if (input.password.length < 10) {
    return { ok: false as const, error: "Use a password of at least 10 characters" };
  }

  const { invitation: row } = found;

  await beginAccepting(row.id);

  try {
    const created = await auth.api.signUpEmail({
      body: { email: row.email, password: input.password, name },
      headers: await headers(),
      asResponse: false,
    });

    const userId = created.user.id;

    await db
      .insert(member)
      .values({
        id: newId("mem"),
        organizationId: row.organizationId,
        userId,
        role: row.role ?? "member",
      })
      .onConflictDoNothing();

    if (row.teamId) {
      await db
        .insert(teamMember)
        .values({ id: newId("tmem"), teamId: row.teamId, userId })
        .onConflictDoNothing();
    }

    // Used once. The secret is cleared so the link cannot be replayed.
    await db
      .update(invitation)
      .set({ status: "accepted", tokenHash: null })
      .where(eq(invitation.id, row.id));

    return { ok: true as const };
  } catch (error) {
    // Put it back, so a failed attempt does not burn the invitation.
    await db.update(invitation).set({ status: "pending" }).where(eq(invitation.id, row.id));
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "That did not work",
    };
  }
}
