"use client";

import { Avatar, IconButton, Sheet, SheetContent, SheetTitle, Wordmark } from "@/components/kit";
import { isFullBleed } from "@/lib/full-bleed";
import { type View, wayOut } from "@/lib/last-view";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  FileText,
  Forward,
  Gauge,
  Globe,
  Inbox,
  KeyRound,
  ListChecks,
  Mail,
  Megaphone,
  Menu,
  Palette,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Tag,
  ToggleRight,
  User,
  Users,
  UsersRound,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hidden unless the person holds this capability. */
  needs?: string;
  /**
   * Hidden unless that half of the product is switched on. Absent means the
   * item belongs to both — domains, templates and the email log are read by
   * a marketing instance as much as by a mailbox one.
   */
  feature?: "inbox" | "campaigns";
  /** Leaves the app. Never highlights, and opens in its own tab. */
  external?: boolean;
}

/** Grouped the way you think about the system, not the way it is stored. */
const GROUPS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/settings/overview", label: "Overview", icon: Gauge, needs: "mailbox:manage" },
    ],
  },
  {
    title: "Sending",
    items: [
      { href: "/settings/domains", label: "Domains", icon: Globe, needs: "domain:manage" },
      {
        href: "/settings/reporting",
        label: "Delivery reporting",
        icon: Activity,
        needs: "domain:manage",
      },
      {
        href: "/settings/mailboxes",
        label: "Mailboxes",
        icon: Mail,
        needs: "mailbox:settings",
        feature: "inbox",
      },
      { href: "/settings/templates", label: "Templates", icon: FileText, needs: "rules:manage" },
      { href: "/settings/metrics", label: "Metrics", icon: BarChart3, needs: "mail:read" },
      { href: "/settings/logs", label: "Email log", icon: ScrollText, needs: "mail:read" },
      {
        href: "/settings/blocked",
        label: "Blocked addresses",
        icon: ShieldOff,
        needs: "rules:manage",
      },
    ],
  },
  {
    title: "Receiving",
    items: [
      {
        href: "/settings/inbound",
        label: "Inbound worker",
        icon: Inbox,
        needs: "inbound:manage",
        feature: "inbox",
      },
      {
        href: "/settings/forwarding",
        label: "Forwarding",
        icon: Forward,
        needs: "inbound:manage",
        feature: "inbox",
      },
      {
        href: "/settings/filters",
        label: "Filters",
        icon: SlidersHorizontal,
        needs: "rules:manage",
        feature: "inbox",
      },
      {
        href: "/settings/labels",
        label: "Labels",
        icon: Tag,
        needs: "rules:manage",
        feature: "inbox",
      },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/settings/people", label: "People", icon: Users, needs: "member:manage" },
      { href: "/settings/teams", label: "Teams", icon: UsersRound, needs: "member:manage" },
      { href: "/settings/access", label: "Access", icon: ShieldCheck, needs: "access:manage" },
      { href: "/settings/api-keys", label: "API keys", icon: KeyRound, needs: "apikey:manage" },
      { href: "/settings/webhooks", label: "Webhooks", icon: Webhook, needs: "apikey:manage" },
      {
        href: "/settings/features",
        label: "Features",
        icon: ToggleRight,
        needs: "instance:manage",
      },
      { href: "/settings/account", label: "Account", icon: User },
      { href: "/settings/notifications", label: "Notifications", icon: Bell },
      { href: "/settings/appearance", label: "Appearance", icon: Palette },
      {
        href: "https://mailroom-docs.shahriyar.dev",
        label: "Documentation",
        icon: BookOpen,
        external: true,
      },
    ],
  },
];

const ALL = GROUPS.flatMap((group) => group.items);

export function SettingsShell({
  user,
  allowed,
  features,
  cameFrom,
  children,
}: {
  user: { name: string; email: string };
  /** The capabilities this person holds; anything else is not offered. */
  allowed: string[];
  /** Which halves of the product this instance has switched on. */
  features: { inbox: boolean; campaigns: boolean };
  /** Which of them they were in when they came here, if it was remembered. */
  cameFrom: View | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer on navigation
  useEffect(() => setNavOpen(false), [pathname]);

  const current = ALL.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.needs || allowed.includes(item.needs)) && (!item.feature || features[item.feature]),
    ),
  })).filter((group) => group.items.length > 0);

  const nav = (
    <SettingsNavPanel
      pathname={pathname}
      user={user}
      groups={groups}
      back={wayOut(features, cameFrom)}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-card">
      <aside className="hidden w-[15rem] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        {nav}
      </aside>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="flex flex-col bg-sidebar p-0" showClose={false}>
          <SheetTitle className="sr-only">Settings navigation</SheetTitle>
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
            {current?.label ?? "Settings"}
          </h1>
        </header>

        {isFullBleed(pathname) ? (
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-6xl divide-y divide-border px-5 pb-16 sm:px-7">
              {children}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsNavPanel({
  pathname,
  user,
  groups,
  back,
}: {
  pathname: string;
  user: { name: string; email: string };
  groups: { title?: string; items: NavItem[] }[];
  /** Where settings was opened from, which is the only way out of it. */
  back: { href: string; label: string };
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center px-4">
        <Wordmark />
      </div>

      <div className="px-2.5 pb-4">
        <Link
          href={back.href}
          className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <ArrowLeft className="size-[17px] shrink-0" />
          {back.label}
        </Link>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        {groups.map((group) => (
          <div key={group.title ?? group.items[0].href} className="mb-1">
            {group.title && <p className="eyebrow px-2 pt-3 pb-1.5">{group.title}</p>}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  !item.external &&
                  (pathname === item.href || pathname.startsWith(`${item.href}/`));
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      {...(item.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13px] transition-colors",
                        active
                          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-[17px] shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {item.external && (
                        <ArrowUpRight className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="px-2.5 pb-2.5">
        <Link
          href="/settings/account"
          className="flex min-w-0 items-center gap-2 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-sidebar-accent"
        >
          <Avatar size="sm" name={user.name} address={user.email} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium">{user.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
          </span>
        </Link>
      </div>
    </>
  );
}
