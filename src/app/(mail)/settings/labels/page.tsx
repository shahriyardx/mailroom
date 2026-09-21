import { LabelPanel } from "@/components/mail/settings-panels";
import { db } from "@/db";
import { label } from "@/db/schema";
import { requireCapability } from "@/server/permissions";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function LabelsSettingsPage() {
  const access = await requireCapability("rules:manage");
  const labels = await db.query.label.findMany({ where: eq(label.organizationId, access.orgId) });

  return <LabelPanel labels={labels} />;
}
