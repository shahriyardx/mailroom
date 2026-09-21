import { SuppressionPanel } from "@/components/mail/suppression-panel";
import { db } from "@/db";
import { suppression } from "@/db/schema";
import { requireAccess } from "@/server/access";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function BlockedSettingsPage() {
  const access = await requireAccess();

  const rows = await db
    .select()
    .from(suppression)
    .where(eq(suppression.organizationId, access.orgId))
    .orderBy(desc(suppression.createdAt))
    .limit(200);

  return <SuppressionPanel rows={rows} />;
}
