"use client";

import {
  IconButton,
  SectionProvider,
  Sheet,
  SheetContent,
  SheetTitle,
  Wordmark,
} from "@/components/kit";
import { SidebarAccount } from "@/components/mail/sidebar-account";
import { VersionNote } from "@/components/mail/version-note";
import { ViewSwitcher } from "@/components/mail/view-switcher";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  FileText,
  Gauge,
  Globe,
  Image as ImageIcon,
  KeyRound,
  ListChecks,
  Megaphone,
  Menu,
  ScrollText,
  ShieldOff,
  Webhook,
  Workflow,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { isFullBleed } from "@/lib/full-bleed";
import { rememberView } from "@/lib/last-view";

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
 * One list, in the order a sender works through it.
 *
 * The screens from Campaigns down to Media are the campaigns view itself;
 * the rest live in settings and are shared with the inbox side. They are
 * listed here rather than left three clicks away behind a gear, because
 * somebody sending a broadcast checks their domain and their logs far more
 * often than they change a password — and once they are all here, they are
 * all the same kind of thing to the person reading the list. Grouping them
 * only draws a line where none is felt.
 */
const NAV: Item[] = [
  { href: "/campaigns", label: "Overview", icon: Gauge },
  { href: "/campaigns/broadcasts", label: "Campaigns", icon: Megaphone },
  { href: "/campaigns/automations", label: "Automations", icon: Workflow },
  { href: "/campaigns/events", label: "Events", icon: Zap },
  { href: "/campaigns/lists", label: "Lists", icon: ListChecks },
  { href: "/campaigns/templates", label: "Templates", icon: FileText, needs: "rules:manage" },
  { href: "/campaigns/media", label: "Media", icon: ImageIcon, needs: "rules:manage" },
  { href: "/campaigns/domains", label: "Domains", icon: Globe, needs: "domain:manage" },
  { href: "/campaigns/metrics", label: "Stats", icon: Activity, needs: "mail:read" },
  { href: "/campaigns/logs", label: "Activity", icon: ScrollText, needs: "mail:read" },
  { href: "/campaigns/reporting", label: "Delivery", icon: Activity, needs: "domain:manage" },
  { href: "/campaigns/blocked", label: "Blocklist", icon: ShieldOff, needs: "rules:manage" },
  { href: "/campaigns/api-keys", label: "API keys", icon: KeyRound, needs: "apikey:manage" },
  { href: "/campaigns/webhooks", label: "Webhooks", icon: Webhook, needs: "apikey:manage" },
  /*
   * Last, and shown to everybody.
   *
   * The documentation is part of the app rather than a website it links out
   * to, so it is a screen like any other — and the one screen nobody needs a
   * capability for, because reading how the thing works is not an action on
   * anybody's data.
   */
  { href: "/docs", label: "Documentation", icon: BookOpen },
];

export function CampaignsShell({
  user,
  allowed,
  showSwitcher,
  settingsHref,
  children,
}: {
  user: { name: string; email: string };
  /** The capabilities this person holds; anything else is not offered. */
  allowed: string[];
  /** Only when the inbox is switched on too — otherwise there is nowhere to go. */
  showSwitcher: boolean;
  /**
   * The settings screen this person should land on.
   *
   * Worked out on the server, like the inbox side already does, so the gear
   * goes straight there rather than to `/settings` and a redirect — which is
   * an extra round trip and, to anybody reading the status bar, the wrong
   * address.
   */
  settingsHref: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer on navigation
  useEffect(() => setNavOpen(false), [pathname]);

  // So the way out of settings knows to come back here rather than to the
  // inbox, on an instance where both halves are switched on.
  useEffect(() => rememberView("campaigns"), []);

  const nav = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        {/* The same line the inbox carries. Somebody running only the
            campaigns view needs the version in a bug report just as much. */}
        <Wordmark sub={<VersionNote />} />
      </div>

      {showSwitcher ? (
        <div className="px-3 pb-3">
          <ViewSwitcher current="campaigns" />
        </div>
      ) : null}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        <ul className="space-y-0.5">
          {NAV.filter((item) => !item.needs || allowed.includes(item.needs)).map((item) => {
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

      <div className="shrink-0 border-t border-border pt-2.5">
        <SidebarAccount user={user} settingsHref={settingsHref} />
      </div>
    </div>
  );

  /*
   * A builder and a flow canvas take the whole window.
   *
   * Both are places somebody works for half an hour at a time, and both are
   * wider than they are tall — so fifteen rems of navigation beside them is
   * fifteen rems the canvas does not get. Each carries its own arrow back.
   */
  const immersive = isFullBleed(pathname);

  return (
    <div className="flex h-dvh overflow-hidden bg-card">
      {!immersive && (
        <aside className="hidden w-[15rem] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
          {nav}
        </aside>
      )}

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="flex flex-col bg-sidebar p-0" showClose={false}>
          <SheetTitle className="sr-only">Campaigns navigation</SheetTitle>
          {nav}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Only a way back to the navigation. The page owns its own title,
            the way an application screen does rather than a settings one. */}
        {!immersive && (
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
        )}

        {/* Panels rendered under here are application panels, including the
            shared screens this view borrows from settings. */}
        <SectionProvider kind="app">
          {immersive ? (
            <main className="flex min-h-0 flex-1 flex-col">{children}</main>
          ) : (
            <main className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[1100px] px-5 pt-4 pb-10 sm:px-8 md:pt-8">
                {children}
              </div>
            </main>
          )}
        </SectionProvider>
      </div>
    </div>
  );
}
