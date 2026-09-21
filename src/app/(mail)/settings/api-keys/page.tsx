import { ApiKeyPanel } from "@/components/mail/api-key-panel";
import { db } from "@/db";
import { apiKey } from "@/db/schema";
import { env } from "@/lib/env";
import { listMailboxes } from "@/server/mailboxes";
import { requireCapability } from "@/server/permissions";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function ApiKeysSettingsPage() {
  const access = await requireCapability("apikey:manage");
  const [keys, mailboxes] = await Promise.all([
    db.query.apiKey.findMany({
      where: eq(apiKey.organizationId, access.orgId),
      orderBy: (k, { desc }) => [desc(k.createdAt)],
    }),
    listMailboxes(access.orgId),
  ]);

  return <ApiKeyPanel keys={keys} mailboxes={mailboxes} appUrl={env.appUrl} />;
}
