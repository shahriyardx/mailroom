import { Toaster } from "@/components/kit";
import { ThemeSync } from "@/components/mail/theme-sync";
import { requireAccess } from "@/server/access";
import { getAppearance } from "@/server/preferences";

/**
 * Deliberately outside the mail layout.
 *
 * That layout is what redirects an unfinished instance here, so rendering the
 * wizard inside it would redirect to itself for ever.
 */
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  const look = await getAppearance(access.userId);

  return (
    <>
      <ThemeSync theme={look.theme} />
      {children}
      <Toaster />
    </>
  );
}
