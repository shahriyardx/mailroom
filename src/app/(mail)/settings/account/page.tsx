import { AccountPanel } from "@/components/mail/account-panel";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireAccess } from "@/server/access";
import { listDomainsForUser } from "@/server/domains";
import { listMailboxes } from "@/server/mailboxes";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const access = await requireAccess();
  const [membership] = await db.select().from(member).where(eq(member.id, access.memberId));
  const [mailboxes, domains] = await Promise.all([
    listMailboxes(access.orgId),
    listDomainsForUser(access.orgId),
  ]);

  return (
    <AccountPanel
      name={access.name}
      role={access.role}
      email={access.email}
      createdAt={membership?.createdAt ?? new Date()}
      mailboxCount={mailboxes.length}
      domainCount={domains.length}
    />
  );
}
