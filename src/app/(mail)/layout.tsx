import { Toaster } from "@/components/kit";
import { ComposerProvider } from "@/components/mail/composer-provider";
import { LiveUpdates } from "@/components/mail/live-updates";
import { ThemeSync } from "@/components/mail/theme-sync";
import { db } from "@/db";
import { label, member } from "@/db/schema";
import { requireAccess } from "@/server/access";
import { sendableMailboxesFor } from "@/server/mailboxes";
import { getAppearance } from "@/server/preferences";
import { needsSetup } from "@/server/workspace";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

export default async function MailLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();

  // A fresh instance has nothing in it, and an empty inbox with no hint of
  // what to press is where somebody decides this was a mistake. The wizard is
  // stamped once and never asks again.
  if (await needsSetup(access.orgId)) redirect("/setup");

  // The composer offers only what this person can actually send as.
  const mailboxes = await sendableMailboxesFor(access);

  // Their own choice first; the instance default is only a fallback for
  // somebody who has never made one.
  const [membership] = await db.select().from(member).where(eq(member.id, access.memberId));
  const chosen = membership?.defaultMailboxId;
  const defaultMailboxId =
    (chosen && mailboxes.some((box) => box.id === chosen) ? chosen : null) ??
    mailboxes.find((box) => box.isDefault)?.id ??
    mailboxes[0]?.id ??
    null;
  // Labels are fetched here too so the provider tree stays stable between views.
  await db.query.label.findMany({ where: eq(label.organizationId, access.orgId) });

  const look = await getAppearance(access.userId);

  return (
    <ComposerProvider mailboxes={mailboxes} defaultMailboxId={defaultMailboxId}>
      <ThemeSync theme={look.theme} />
      {children}
      <LiveUpdates />
      {/* Nothing was rendering the toasts the actions raise. */}
      <Toaster />
    </ComposerProvider>
  );
}
