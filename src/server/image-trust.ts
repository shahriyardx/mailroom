import "server-only";
import { db } from "@/db";
import { imageTrust } from "@/db/schema";
import { newId } from "@/lib/utils";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Which senders this reader has decided about.
 *
 * Remote images are blocked by default because loading one tells the sender
 * that a person opened the message and roughly when. Once a reader has said
 * a particular sender may load them, saying it again on every message is
 * pointless — and saying no is worth keeping too, so a sender who has been
 * refused does not ask again on the next message.
 */
export async function imageChoices(
  access: { userId: string },
  senders: string[],
): Promise<Map<string, boolean>> {
  const wanted = [...new Set(senders.map((one) => one.toLowerCase().trim()).filter(Boolean))];
  if (wanted.length === 0) return new Map();

  const rows = await db
    .select({ sender: imageTrust.sender, allowed: imageTrust.allowed })
    .from(imageTrust)
    .where(and(eq(imageTrust.userId, access.userId), inArray(imageTrust.sender, wanted)));

  return new Map(rows.map((row) => [row.sender, row.allowed]));
}

/** Remembers this reader's answer for this sender, replacing any earlier one. */
export async function rememberImageChoice(
  access: { userId: string; orgId: string },
  sender: string,
  allowed: boolean,
) {
  const address = sender.toLowerCase().trim();
  if (!address) return;

  await db
    .insert(imageTrust)
    .values({
      id: newId("imt"),
      organizationId: access.orgId,
      userId: access.userId,
      sender: address,
      allowed,
    })
    .onConflictDoUpdate({
      target: [imageTrust.userId, imageTrust.sender],
      set: { allowed, updatedAt: new Date() },
    });
}
