"use client";

import { cn } from "@/lib/utils";
import { Globe, KeyRound, Mail, ShieldOff, SlidersHorizontal, Tag, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/settings/domains", label: "Domains", icon: Globe, hint: "SES identities and DNS" },
  { href: "/settings/mailboxes", label: "Mailboxes", icon: Mail, hint: "Addresses and signatures" },
  {
    href: "/settings/api-keys",
    label: "API keys",
    icon: KeyRound,
    hint: "Send from your own code",
  },
  { href: "/settings/blocked", label: "Blocked", icon: ShieldOff, hint: "Bounces and complaints" },
  { href: "/settings/labels", label: "Labels", icon: Tag, hint: "Tag threads" },
  { href: "/settings/filters", label: "Filters", icon: SlidersHorizontal, hint: "Inbound rules" },
  { href: "/settings/account", label: "Account", icon: User, hint: "Sign-in details" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto lg:w-52 lg:shrink-0 lg:flex-col lg:overflow-visible">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-[3px] px-2.5 py-1.5 text-[12.5px] transition",
              active
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
