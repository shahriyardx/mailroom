"use client";

import { Avatar, IconButton, Sheet, SheetContent, SheetTitle } from "@/components/kit";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Globe,
  Inbox,
  KeyRound,
  Mail,
  Mails,
  Menu,
  ShieldOff,
  SlidersHorizontal,
  Tag,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Grouped the way you think about the system, not the way it is stored. */
const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Sending",
    items: [
      { href: "/settings/domains", label: "Domains", icon: Globe },
      { href: "/settings/mailboxes", label: "Mailboxes", icon: Mail },
      { href: "/settings/blocked", label: "Blocked addresses", icon: ShieldOff },
    ],
  },
  {
    title: "Receiving",
    items: [
      { href: "/settings/inbound", label: "Inbound worker", icon: Inbox },
      { href: "/settings/filters", label: "Filters", icon: SlidersHorizontal },
      { href: "/settings/labels", label: "Labels", icon: Tag },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/settings/api-keys", label: "API keys", icon: KeyRound },
      { href: "/settings/account", label: "Account", icon: User },
    ],
  },
];

const ALL = GROUPS.flatMap((group) => group.items);

export function SettingsShell({
  user,
  children,
}: {
  user: { name: string; email: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer on navigation
  useEffect(() => setNavOpen(false), [pathname]);

  const current = ALL.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  const nav = <SettingsNavPanel pathname={pathname} user={user} />;

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

        <div className="min-h-0 flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-3xl space-y-4 p-4 pb-12 sm:p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

function SettingsNavPanel({
  pathname,
  user,
}: {
  pathname: string;
  user: { name: string; email: string };
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <span className="grid size-7 place-items-center rounded-[9px] bg-primary text-primary-foreground">
          <Mails className="size-4" />
        </span>
        <span className="font-display text-[15px] tracking-[-0.02em]">
          <span className="font-semibold">post</span>
          <span className="text-muted-foreground"> mail</span>
        </span>
      </div>

      <div className="px-2.5 pb-4">
        <Link
          href="/mail/all/inbox"
          className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <ArrowLeft className="size-[17px] shrink-0" />
          Back to mail
        </Link>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        {GROUPS.map((group) => (
          <div key={group.title} className="mb-1">
            <p className="eyebrow px-2 pt-3 pb-1.5">{group.title}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13px] transition-colors",
                        active
                          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-[17px] shrink-0" />
                      <span className="truncate">{item.label}</span>
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
