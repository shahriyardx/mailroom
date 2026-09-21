import "server-only";

import { notFound } from "next/navigation";
import { type Access, type Role, requireAccess } from "./access";

/**
 * What a person may do. Roles cover the instance; grants (phase two) cover
 * individual domains and mailboxes.
 *
 * The split follows who carries the consequences. Adding a domain changes what
 * the company can send as and touches DNS, so it belongs to the one owner.
 * Running the place day to day — mailboxes, people, who may see what — is an
 * administrator's work. A plain member administers nothing and sees only the
 * mail they have been given.
 */
export const CAPABILITIES = {
  /** Add, verify or remove a sending domain. DNS and SES identities. */
  "domain:manage": ["owner"],
  /** Connect Cloudflare, deploy or delete the inbound worker, route zones. */
  "inbound:manage": ["owner"],
  /** Hand the instance to someone else, or remove it. */
  "instance:manage": ["owner"],

  /** Create, edit and delete mailboxes. */
  "mailbox:manage": ["owner", "admin"],
  /** Invite people, change their role, remove them. */
  "member:manage": ["owner", "admin"],
  /** Create teams and decide which domains and mailboxes each one reaches. */
  "team:manage": ["owner", "admin"],
  /** Grant a person or a team access to a mailbox. */
  "access:manage": ["owner", "admin"],
  /** Create and revoke API keys. */
  "apikey:manage": ["owner", "admin"],
  /** Labels, filters and the blocked list, which apply across the company. */
  "rules:manage": ["owner", "admin"],

  /** Read the mail in a mailbox they have been granted. */
  "mail:read": ["owner", "admin", "member"],
  /** Send as a mailbox they have been granted. */
  "mail:send": ["owner", "admin", "member"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(access: Access, capability: Capability) {
  return (CAPABILITIES[capability] as readonly Role[]).includes(access.role);
}

/** Throws rather than returning false, for the actions that must not proceed. */
export function assertCan(access: Access, capability: Capability) {
  if (!can(access, capability)) {
    throw new Error(REFUSALS[capability]);
  }
}

/** Said plainly, because a refusal that does not explain itself is a bug report. */
const REFUSALS: Record<Capability, string> = {
  "domain:manage": "Only the owner can add or remove a sending domain.",
  "inbound:manage": "Only the owner can change how mail is received.",
  "instance:manage": "Only the owner can change this.",
  "mailbox:manage": "Only an owner or an admin can manage mailboxes.",
  "member:manage": "Only an owner or an admin can manage people.",
  "team:manage": "Only an owner or an admin can manage teams.",
  "access:manage": "Only an owner or an admin can grant access.",
  "apikey:manage": "Only an owner or an admin can manage API keys.",
  "rules:manage": "Only an owner or an admin can change labels, filters and blocking.",
  "mail:read": "You do not have access to this mailbox.",
  "mail:send": "You cannot send as this mailbox.",
};

/**
 * For a page rather than an action. Hiding a link in the sidebar decides what
 * is easy to reach, not what is reachable: a page has to refuse on its own or
 * typing its address is enough to read it.
 *
 * Answers "not found" rather than "not allowed", so the existence of a screen
 * is not itself something a member learns.
 */
export async function requireCapability(capability: Capability): Promise<Access> {
  const access = await requireAccess();
  if (!can(access, capability)) notFound();
  return access;
}
