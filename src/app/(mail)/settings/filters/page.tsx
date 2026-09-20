import { RulePanel } from "@/components/mail/settings-panels";
import { db } from "@/db";
import { filterRule } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function FiltersSettingsPage() {
  const user = await requireUser();
  const rules = await db.query.filterRule.findMany({ where: eq(filterRule.userId, user.id) });

  return <RulePanel rules={rules} />;
}
