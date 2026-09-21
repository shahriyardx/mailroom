import { MailboxPanel } from "@/components/mail/settings-panels";
import { requireAccess } from "@/server/access";
import { listDomainsForUser } from "@/server/domains";
import { mailboxAdministration } from "@/server/grants";
import { listMailboxes } from "@/server/mailboxes";
import { can } from "@/server/permissions";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MailboxesSettingsPage() {
  const access = await requireAccess();

  // An administrator manages every mailbox. Anyone else is here because a
  // grant lets them change one, or add to a domain.
  const administers = can(access, "mailbox:manage");
  const own = administers ? null : await mailboxAdministration(access);
  if (!administers && !own?.any) notFound();

  const [allMailboxes, allDomains] = await Promise.all([
    listMailboxes(access.orgId),
    listDomainsForUser(access.orgId),
  ]);

  // Show only what this person can act on, so the screen never offers a
  // change that would be refused.
  const mailboxes = administers
    ? allMailboxes
    : allMailboxes.filter((box) => own?.manageable.includes(box.id));

  const domains =
    administers || own?.creatable === "all"
      ? allDomains
      : allDomains.filter((domain) => own?.creatable.includes(domain.id));

  return <MailboxPanel mailboxes={mailboxes} domains={domains} />;
}
