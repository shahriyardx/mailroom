import { LabelPanel } from "@/components/mail/settings-panels";
import { db } from "@/db";
import { label } from "@/db/schema";
import { requireAccess } from "@/server/access";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function LabelsSettingsPage() {
  const access = await requireAccess();
  const labels = await db.query.label.findMany({ where: eq(label.organizationId, access.orgId) });

  return <LabelPanel labels={labels} />;
}
