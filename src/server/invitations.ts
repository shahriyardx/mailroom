import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { db } from "@/db";
import { invitation, mailbox, organization } from "@/db/schema";
import { env } from "@/lib/env";
import { newId } from "@/lib/utils";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { deliverMessage } from "./send";

export const INVITE_DAYS = 14;

export function makeInviteToken() {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: hashToken(secret) };
}

export function hashToken(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export function inviteLink(secret: string) {
  return `${env.appUrl.replace(/\/+$/, "")}/invite/${secret}`;
}

/** The invitation a link refers to, if it is real, pending and still in date. */
export async function invitationForToken(secret: string) {
  const [row] = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.tokenHash, hashToken(secret)), gt(invitation.expiresAt, new Date())))
    .limit(1);

  if (!row) return null;
  if (row.status === "accepted") return null;

  const [company] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, row.organizationId));

  return { invitation: row, organization: company ?? null };
}

/**
 * Sends the invitation from a mailbox the company already owns. Returns what
 * happened rather than throwing: an invitation that could not be emailed is
 * still a valid invitation, and the link can be passed on by hand.
 *
 * The sender can be chosen, because which address a new colleague is written
 * to from is a matter of how the company presents itself. Without a choice it
 * is the default mailbox.
 */
export async function sendInvitationEmail(input: {
  orgId: string;
  email: string;
  secret: string;
  inviterName: string;
  companyName: string;
  fromMailboxId?: string | null;
}) {
  const from = await invitationSender(input.orgId, input.fromMailboxId);

  if (!from) {
    return { sent: false as const, reason: "There is no mailbox to send the invitation from" };
  }

  const link = inviteLink(input.secret);
  const company = input.companyName;

  try {
    await deliverMessage({
      orgId: input.orgId,
      mailboxId: from.id,
      to: [{ address: input.email, name: null }],
      subject: `${input.inviterName} invited you to ${company}`,
      text: [
        `${input.inviterName} has invited you to ${company} on Mailroom.`,
        "",
        "Open this link to accept and choose a password:",
        link,
        "",
        `The link works once and expires in ${INVITE_DAYS} days.`,
        "If you were not expecting this, ignore it and nothing happens.",
      ].join("\n"),
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px">
          <p style="font-size:15px;line-height:1.5">
            <strong>${escapeHtml(input.inviterName)}</strong> has invited you to
            <strong>${escapeHtml(company)}</strong> on Mailroom.
          </p>
          <p style="margin:24px 0">
            <a href="${link}"
               style="background:#5a45d6;color:#fff;text-decoration:none;padding:11px 20px;border-radius:999px;font-size:14px;display:inline-block">
              Accept the invitation
            </a>
          </p>
          <p style="font-size:13px;color:#666;line-height:1.5">
            The link works once and expires in ${INVITE_DAYS} days.<br>
            If you were not expecting this, ignore it and nothing happens.
          </p>
        </div>
      `,
    });
    return { sent: true as const };
  } catch (error) {
    return {
      sent: false as const,
      reason: error instanceof Error ? error.message : "The invitation could not be sent",
    };
  }
}

/**
 * The mailbox an invitation goes out from. A chosen one is checked against
 * the company, so an id from a form cannot reach another instance's address;
 * an unusable choice falls back rather than failing, since the invitation
 * itself is still worth making.
 */
async function invitationSender(orgId: string, chosenId?: string | null) {
  if (chosenId) {
    const [chosen] = await db
      .select()
      .from(mailbox)
      .where(and(eq(mailbox.id, chosenId), eq(mailbox.organizationId, orgId)))
      .limit(1);
    if (chosen) return chosen;
  }

  const [fallback] = await db
    .select()
    .from(mailbox)
    .where(eq(mailbox.organizationId, orgId))
    .orderBy(desc(mailbox.isDefault), asc(mailbox.address))
    .limit(1);
  return fallback ?? null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Marks an invitation as being claimed. Only the link holder can do this. */
export async function beginAccepting(invitationId: string) {
  await db.update(invitation).set({ status: "accepting" }).where(eq(invitation.id, invitationId));
}

export function freshExpiry() {
  return new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
}

export function newInvitationId() {
  return newId("inv");
}
