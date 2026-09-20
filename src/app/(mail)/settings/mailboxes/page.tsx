import { MailboxPanel } from "@/components/mail/settings-panels";
import { requireUser } from "@/lib/session";
import { listDomainsForUser } from "@/server/domains";
import { listMailboxes } from "@/server/mailboxes";

export const dynamic = "force-dynamic";

export default async function MailboxesSettingsPage() {
  const user = await requireUser();
  const [mailboxes, domains] = await Promise.all([
    listMailboxes(user.id),
    listDomainsForUser(user.id),
  ]);

  return <MailboxPanel mailboxes={mailboxes} domains={domains} />;
}
