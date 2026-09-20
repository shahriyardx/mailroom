import { SuppressionPanel } from "@/components/mail/suppression-panel";
import { db } from "@/db";
import { suppression } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function BlockedSettingsPage() {
  const user = await requireUser();

  const rows = await db
    .select()
    .from(suppression)
    .where(eq(suppression.userId, user.id))
    .orderBy(desc(suppression.createdAt))
    .limit(200);

  return <SuppressionPanel rows={rows} />;
}
