import { WebhookPanel } from "@/components/mail/webhook-panel";
import { db } from "@/db";
import { domain, webhook, webhookDelivery } from "@/db/schema";
import { listMailboxes } from "@/server/mailboxes";
import { requireCapability } from "@/server/permissions";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function WebhooksSettingsPage() {
  const access = await requireCapability("apikey:manage");

  const [hooks, deliveries, mailboxes, domains] = await Promise.all([
    db
      .select()
      .from(webhook)
      .where(eq(webhook.organizationId, access.orgId))
      .orderBy(desc(webhook.createdAt)),
    db
      .select()
      .from(webhookDelivery)
      .where(eq(webhookDelivery.organizationId, access.orgId))
      .orderBy(desc(webhookDelivery.createdAt))
      .limit(25),
    listMailboxes(access.orgId),
    db
      .select({ id: domain.id, name: domain.name })
      .from(domain)
      .where(eq(domain.organizationId, access.orgId))
      .orderBy(domain.name),
  ]);

  return (
    <WebhookPanel
      webhooks={hooks}
      deliveries={deliveries}
      mailboxes={mailboxes}
      domains={domains}
    />
  );
}
