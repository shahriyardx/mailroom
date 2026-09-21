import { Toaster } from "@/components/kit";
import { ComposerProvider } from "@/components/mail/composer-provider";
import { LiveUpdates } from "@/components/mail/live-updates";
import { db } from "@/db";
import { label } from "@/db/schema";
import { requireAccess } from "@/server/access";
import { sendableMailboxesFor } from "@/server/mailboxes";
import { eq } from "drizzle-orm";

export default async function MailLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  // The composer offers only what this person can actually send as.
  const mailboxes = await sendableMailboxesFor(access);
  // Labels are fetched here too so the provider tree stays stable between views.
  await db.query.label.findMany({ where: eq(label.organizationId, access.orgId) });

  return (
    <ComposerProvider mailboxes={mailboxes}>
      {children}
      <LiveUpdates />
      {/* Nothing was rendering the toasts the actions raise. */}
      <Toaster />
    </ComposerProvider>
  );
}
