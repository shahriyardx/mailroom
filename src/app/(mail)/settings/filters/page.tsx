import { RulePanel } from "@/components/mail/settings-panels";
import { db } from "@/db";
import { filterRule } from "@/db/schema";
import { requireCapability } from "@/server/permissions";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function FiltersSettingsPage() {
  const access = await requireCapability("rules:manage");
  const rules = await db.query.filterRule.findMany({
    where: eq(filterRule.organizationId, access.orgId),
  });

  return <RulePanel rules={rules} />;
}
