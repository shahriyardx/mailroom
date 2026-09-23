import { Toaster } from "@/components/kit";
import { DocsShell } from "@/components/mail/docs-shell";
import { ThemeSync } from "@/components/mail/theme-sync";
import { VIEW_COOKIE, readView, wayOut } from "@/lib/last-view";
import { requireAccess } from "@/server/access";
import { getAppearance } from "@/server/preferences";
import { workspaceSettings } from "@/server/workspace";
import { cookies } from "next/headers";

export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAccess();
  const settings = await workspaceSettings(access.orgId);
  const look = await getAppearance(access.userId);
  // Read here rather than in the shell, so the way back is right in the first
  // paint instead of correcting itself once the browser catches up.
  const cameFrom = readView((await cookies()).get(VIEW_COOKIE)?.value);

  return (
    <>
      <ThemeSync theme={look.theme} />
      <DocsShell
        back={wayOut(
          { inbox: settings.inboxEnabled, campaigns: settings.campaignsEnabled },
          cameFrom,
        )}
      >
        {children}
      </DocsShell>
      <Toaster />
    </>
  );
}
