import { LabelPanel } from "@/components/mail/settings-panels";
import { db } from "@/db";
import { label } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function LabelsSettingsPage() {
  const user = await requireUser();
  const labels = await db.query.label.findMany({ where: eq(label.userId, user.id) });

  return <LabelPanel labels={labels} />;
}
