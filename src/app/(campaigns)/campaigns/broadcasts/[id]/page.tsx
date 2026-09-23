import { BroadcastBuilder } from "@/components/mail/template-builder";
import { db } from "@/db";
import { mailingList } from "@/db/schema";
import { findBroadcast } from "@/server/campaigns";
import { requireCapability } from "@/server/permissions";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

// Written out rather than re-exported: Next reads this at build time and only
// understands a literal here.
export const dynamic = "force-dynamic";

/*
 * One broadcast, in the same builder a template uses.
 *
 * A broadcast and a template are the same document with different paperwork
 * around it, and somebody writing one to a list should not have a worse
 * editor than somebody saving one for later.
 */
export default async function BroadcastPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireCapability("mail:send");
  const { id } = await params;

  const row = await findBroadcast(access.orgId, id);
  if (!row) notFound();

  const [list] = await db
    .select({ name: mailingList.name })
    .from(mailingList)
    .where(eq(mailingList.id, row.listId))
    .limit(1);

  return (
    <BroadcastBuilder
      broadcast={row}
      listName={list?.name ?? "a list"}
      basePath="/campaigns/broadcasts"
    />
  );
}
