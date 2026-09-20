import { Toaster } from "@/components/kit";
import { ComposerProvider } from "@/components/mail/composer-provider";
import { db } from "@/db";
import { label } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { listMailboxes } from "@/server/mailboxes";
import { eq } from "drizzle-orm";

export default async function MailLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const mailboxes = await listMailboxes(user.id);
  // Labels are fetched here too so the provider tree stays stable between views.
  await db.query.label.findMany({ where: eq(label.userId, user.id) });

  return (
    <ComposerProvider mailboxes={mailboxes}>
      {children}
      {/* Nothing was rendering the toasts the actions raise. */}
      <Toaster />
    </ComposerProvider>
  );
}
