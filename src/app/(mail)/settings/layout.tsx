import { SettingsNav } from "@/components/mail/settings-nav";
import { requireUser } from "@/lib/session";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl p-4 sm:p-5">
        <div className="flex items-center gap-2.5 pb-4">
          <Link
            href="/mail/all/inbox"
            aria-label="Back to mail"
            className="rounded-lg border p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-medium text-[14px]">Settings</h1>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <SettingsNav />
          <div className="min-w-0 flex-1 space-y-3 pb-10">{children}</div>
        </div>
      </div>
    </div>
  );
}
