/**
 * What a grant can be about.
 *
 * Two sides, and they do not mix. On the mail side a grant is about a mailbox
 * or the domain above it; on the campaigns side it is about a mailing list, or
 * about every list there is and ever will be. The screen shows them apart
 * because they answer different questions: who reads which mail, and who may
 * write to which audience.
 *
 * Here rather than beside the actions that use them, because a "use server"
 * file may export nothing but functions.
 */

export type ResourceType = "domain" | "mailbox" | "list" | "lists";

export const MAIL_RESOURCES: ResourceType[] = ["domain", "mailbox"];
export const CAMPAIGN_RESOURCES: ResourceType[] = ["list", "lists"];

/** The id a grant on every list carries, since it names no single row. */
export const EVERY_LIST = "*";
