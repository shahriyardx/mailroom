import { ApiKeyPanel } from "@/components/mail/api-key-panel";
import { db } from "@/db";
import { apiKey } from "@/db/schema";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { listMailboxes } from "@/server/mailboxes";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function ApiKeysSettingsPage() {
  const user = await requireUser();
  const [keys, mailboxes] = await Promise.all([
    db.query.apiKey.findMany({
      where: eq(apiKey.userId, user.id),
      orderBy: (k, { desc }) => [desc(k.createdAt)],
    }),
    listMailboxes(user.id),
  ]);

  return <ApiKeyPanel keys={keys} mailboxes={mailboxes} appUrl={env.appUrl} />;
}
