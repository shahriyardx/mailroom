import { AccountPanel } from "@/components/mail/account-panel";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireAccess } from "@/server/access";
import { listDomainsForUser } from "@/server/domains";
import { listMailboxes } from "@/server/mailboxes";
import { getCompany } from "@/server/team";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const access = await requireAccess();
  const [membership] = await db.select().from(member).where(eq(member.id, access.memberId));
  const { company, canRename } = await getCompany();
  const [mailboxes, domains] = await Promise.all([
    listMailboxes(access.orgId),
    listDomainsForUser(access.orgId),
  ]);

  return (
    <AccountPanel
      company={company}
      canRename={canRename}
      name={access.name}
      role={access.role}
      email={access.email}
      createdAt={membership?.createdAt ?? new Date()}
      mailboxCount={mailboxes.length}
      domainCount={domains.length}
    />
  );
}
