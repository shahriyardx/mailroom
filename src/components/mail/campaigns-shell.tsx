"use client";

import { Avatar, IconButton, Sheet, SheetContent, SheetTitle, Wordmark } from "@/components/kit";
import { ViewSwitcher } from "@/components/mail/view-switcher";
import { cn } from "@/lib/utils";
import { Gauge, ListChecks, Megaphone, Menu, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The campaigns side of the app.
 *
 * Its own shell rather than a corner of settings. Sending a newsletter is a
 * day's work with its own screens and its own numbers, and burying it three
 * levels down under a gear icon says it is an afterthought.
 */

const ITEMS = [
  { href: "/campaigns", label: "Overview", icon: Gauge },
  { href: "/campaigns/broadcasts", label: "Broadcasts", icon: Megaphone },
  { href: "/campaigns/lists", label: "Lists", icon: ListChecks },
];

export function CampaignsShell({
  user,
  showSwitcher,
  title,
  children,
}: {
  user: { name: string; email: string };
  /** Only when the inbox is switched on too — otherwise there is nowhere to go. */
  showSwitcher: boolean;
  title: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer on navigation
  useEffect(() => setNavOpen(false), [pathname]);

  const nav = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Wordmark />
      </div>

      {showSwitcher ? (
        <div className="px-3 pb-3">
          <ViewSwitcher current="campaigns" />
        </div>
      ) : null}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5">
        <ul className="space-y-0.5">
          {ITEMS.map((item) => {
            const active =
              item.href === "/campaigns"
                ? pathname === "/campaigns"
                : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors [&_svg]:size-4",
                    active
                      ? "bg-card font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                  )}
                >
                  <item.icon />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-border p-2.5">
        <Link
          href="/settings"
          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground"
        >
          <Avatar name={user.name} size="sm" />
          <span className="min-w-0 flex-1 truncate">{user.name}</span>
          <Settings className="size-4 shrink-0" />
        </Link>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-card">
      <aside className="hidden w-[15rem] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        {nav}
      </aside>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="flex flex-col bg-sidebar p-0" showClose={false}>
          <SheetTitle className="sr-only">Campaigns navigation</SheetTitle>
          {nav}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 sm:px-5">
          <IconButton
            size="md"
            label="Open navigation"
            className="-ml-1.5 md:hidden"
            onClick={() => setNavOpen(true)}
          >
            <Menu />
          </IconButton>
          <h1 className="min-w-0 truncate font-display text-[18px] font-semibold tracking-[-0.02em]">
            {title}
          </h1>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[880px] px-4 py-6 sm:px-6">
            <div className="divide-y divide-border">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
