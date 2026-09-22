"use client";

import {
  Avatar,
  IconButton,
  SectionProvider,
  Sheet,
  SheetContent,
  SheetTitle,
  Wordmark,
} from "@/components/kit";
import { ViewSwitcher } from "@/components/mail/view-switcher";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  FileText,
  Gauge,
  Globe,
  KeyRound,
  ListChecks,
  Megaphone,
  Menu,
  ScrollText,
  Settings,
  ShieldOff,
  Webhook,
} from "lucide-react";
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

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hidden unless the person holds this capability. */
  needs?: string;
}

/*
 * Two groups, because they behave differently.
 *
 * The first is the campaigns view itself. The second is the screens a sender
 * needs constantly — where mail comes from, what happened to it, who may call
 * the API — which live in settings and are shared with the inbox side. They
 * are listed here rather than left three clicks away behind a gear, because
 * somebody sending a broadcast checks their domain and their logs far more
 * often than they change a password.
 */
const GROUPS: { title?: string; items: Item[] }[] = [
  {
    items: [
      { href: "/campaigns", label: "Overview", icon: Gauge },
      { href: "/campaigns/broadcasts", label: "Broadcasts", icon: Megaphone },
      { href: "/campaigns/lists", label: "Lists", icon: ListChecks },
      {
        href: "/campaigns/templates",
        label: "Templates",
        icon: FileText,
        needs: "rules:manage",
      },
    ],
  },
  {
    title: "Sending",
    items: [
      { href: "/campaigns/domains", label: "Domains", icon: Globe, needs: "domain:manage" },
      { href: "/campaigns/metrics", label: "Metrics", icon: Activity, needs: "mail:read" },
      { href: "/campaigns/logs", label: "Logs", icon: ScrollText, needs: "mail:read" },
      {
        href: "/campaigns/reporting",
        label: "Delivery",
        icon: Activity,
        needs: "domain:manage",
      },
      {
        href: "/campaigns/blocked",
        label: "Blocked",
        icon: ShieldOff,
        needs: "rules:manage",
      },
      { href: "/campaigns/api-keys", label: "API keys", icon: KeyRound, needs: "apikey:manage" },
      { href: "/campaigns/webhooks", label: "Webhooks", icon: Webhook, needs: "apikey:manage" },
    ],
  },
];

export function CampaignsShell({
  user,
  allowed,
  showSwitcher,
  children,
}: {
  user: { name: string; email: string };
  /** The capabilities this person holds; anything else is not offered. */
  allowed: string[];
  /** Only when the inbox is switched on too — otherwise there is nowhere to go. */
  showSwitcher: boolean;
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

      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2.5 pb-3">
        {GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.needs || allowed.includes(item.needs));
          if (items.length === 0) return null;

          return (
            <div key={group.title ?? "top"}>
              {group.title ? (
                <p className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {group.title}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {items.map((item) => {
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
            </div>
          );
        })}
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
        {/* Only a way back to the navigation. The page owns its own title,
            the way an application screen does rather than a settings one. */}
        <header className="flex h-12 shrink-0 items-center px-4 md:hidden">
          <IconButton
            size="md"
            label="Open navigation"
            className="-ml-1.5"
            onClick={() => setNavOpen(true)}
          >
            <Menu />
          </IconButton>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1100px] px-5 pt-4 pb-10 sm:px-8 md:pt-8">
            {/* Panels rendered under here are application panels, including
                the shared screens this view borrows from settings. */}
            <SectionProvider kind="app">{children}</SectionProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
