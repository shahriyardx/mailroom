import { AccountPanel } from "@/components/mail/account-panel";
import { requireUser } from "@/lib/session";
import { listDomainsForUser } from "@/server/domains";
import { listMailboxes } from "@/server/mailboxes";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const user = await requireUser();
  const [mailboxes, domains] = await Promise.all([
    listMailboxes(user.id),
    listDomainsForUser(user.id),
  ]);

  return (
    <AccountPanel
      name={user.name}
      email={user.email}
      createdAt={user.createdAt}
      mailboxCount={mailboxes.length}
      domainCount={domains.length}
    />
  );
}
