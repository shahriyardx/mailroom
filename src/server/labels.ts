import "server-only";
import { db } from "@/db";
import { label } from "@/db/schema";
import { newId } from "@/lib/utils";

/**
 * Adds a label, or hands back the one that is already called that.
 *
 * Names are unique per organisation, so a second attempt at one inserts
 * nothing. Returning the id it would have had leaves the caller holding a row
 * that does not exist — which is how applying a newly made label to the
 * conversation in front of you could silently do nothing at all.
 */
export async function upsertLabel(orgId: string, name: string, color: string) {
  const [row] = await db
    .insert(label)
    .values({ id: newId("lbl"), organizationId: orgId, name, color })
    .onConflictDoUpdate({
      // A label that exists keeps the colour it was given; this is a way of
      // finding it, not a way of restyling it behind someone's back.
      target: [label.organizationId, label.name],
      set: { name },
    })
    .returning({ id: label.id });

  return row!.id;
}
