import { MailboxPanel } from "@/components/mail/settings-panels";
import { listDomainsForUser } from "@/server/domains";
import { listMailboxes } from "@/server/mailboxes";
import { requireCapability } from "@/server/permissions";

export const dynamic = "force-dynamic";

export default async function MailboxesSettingsPage() {
  const access = await requireCapability("mailbox:manage");
  const [mailboxes, domains] = await Promise.all([
    listMailboxes(access.orgId),
    listDomainsForUser(access.orgId),
  ]);

  return <MailboxPanel mailboxes={mailboxes} domains={domains} />;
}
