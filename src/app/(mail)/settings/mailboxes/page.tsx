import { MailboxPanel } from "@/components/mail/settings-panels";
import { requireAccess } from "@/server/access";
import { listDomainsForUser } from "@/server/domains";
import { listMailboxes } from "@/server/mailboxes";

export const dynamic = "force-dynamic";

export default async function MailboxesSettingsPage() {
  const access = await requireAccess();
  const [mailboxes, domains] = await Promise.all([
    listMailboxes(access.orgId),
    listDomainsForUser(access.orgId),
  ]);

  return <MailboxPanel mailboxes={mailboxes} domains={domains} />;
}
