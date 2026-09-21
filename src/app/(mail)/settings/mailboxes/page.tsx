import { MailboxPanel } from "@/components/mail/settings-panels";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireAccess } from "@/server/access";
import { listDomainsForUser } from "@/server/domains";
import { mailboxAdministration, sendableMailboxIds } from "@/server/grants";
import { listMailboxes } from "@/server/mailboxes";
import { can } from "@/server/permissions";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MailboxesSettingsPage() {
  const access = await requireAccess();

  // An administrator manages every mailbox. Anyone else is here because a
  // grant lets them change one, or add to a domain.
  const administers = can(access, "mailbox:manage");
  const own = administers ? null : await mailboxAdministration(access);
  if (!administers && !own?.any) notFound();

  const [allMailboxes, allDomains, sendable, membership] = await Promise.all([
    listMailboxes(access.orgId),
    listDomainsForUser(access.orgId),
    sendableMailboxIds(access),
    db.select().from(member).where(eq(member.id, access.memberId)),
  ]);

  // Every mailbox this person can read. Seeing that an address exists is
  // part of reading its mail; what they may do with it is decided per row.
  const mailboxes = administers
    ? allMailboxes
    : allMailboxes.filter((box) => own?.readable.includes(box.id));

  // Every domain is still passed, because an existing mailbox is judged
  // against its own domain whether or not this person may add to it.
  const creatable =
    administers || own?.creatable === "all"
      ? allDomains
      : allDomains.filter((domain) => own?.creatable.includes(domain.id));

  return (
    <MailboxPanel
      mailboxes={mailboxes}
      domains={allDomains}
      creatable={creatable}
      administers={administers}
      manageable={administers ? undefined : (own?.manageable ?? [])}
      sendableIds={sendable}
      myDefaultId={membership[0]?.defaultMailboxId ?? null}
    />
  );
}
