import { IconButton } from "@/components/kit";
import { SettingsNav } from "@/components/mail/settings-nav";
import { requireUser } from "@/lib/session";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <div className="flex items-center gap-3 pb-5">
          <IconButton size="md" variant="outline" label="Back to mail" asChild>
            <Link href="/mail/all/inbox">
              <ArrowLeft />
            </Link>
          </IconButton>
          <div className="min-w-0">
            <h1 className="font-display text-[18px] font-semibold tracking-[-0.02em]">Settings</h1>
            <p className="truncate font-mono text-[11.5px] text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <div className="flex flex-col gap-5 lg:flex-row lg:gap-7">
          <SettingsNav />
          <div className="min-w-0 flex-1 space-y-4 pb-10">{children}</div>
        </div>
      </div>
    </div>
  );
}
