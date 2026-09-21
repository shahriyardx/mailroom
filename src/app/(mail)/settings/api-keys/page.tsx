import { ApiKeyPanel } from "@/components/mail/api-key-panel";
import { db } from "@/db";
import { domain, apiKey } from "@/db/schema";
import { env } from "@/lib/env";
import { listMailboxes } from "@/server/mailboxes";
import { requireCapability } from "@/server/permissions";
import { asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function ApiKeysSettingsPage() {
  const access = await requireCapability("apikey:manage");
  const [keys, mailboxes, domains] = await Promise.all([
    db.query.apiKey.findMany({
      where: eq(apiKey.organizationId, access.orgId),
      orderBy: (k, { desc }) => [desc(k.createdAt)],
    }),
    listMailboxes(access.orgId),
    db
      .select({ id: domain.id, name: domain.name })
      .from(domain)
      .where(eq(domain.organizationId, access.orgId))
      .orderBy(asc(domain.name)),
  ]);

  return <ApiKeyPanel keys={keys} mailboxes={mailboxes} domains={domains} appUrl={env.appUrl} />;
}
