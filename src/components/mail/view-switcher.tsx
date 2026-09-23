"use client";

import { Inbox, Megaphone } from "lucide-react";
import Link from "next/link";

/**
 * Moving between the two halves of the app.
 *
 * Only rendered when both are switched on. An instance running one of them
 * has nowhere to switch to, and a control with one option is noise.
 *
 * A pair of links rather than a toggle: each side is a real place with its own
 * URL, and somebody who bookmarks the campaigns view should land there.
 *
 * The two halves share the width evenly. The track is as wide as the sidebar
 * either way, so tabs sized to their own words leave a strip of empty track
 * on the right that reads as a third option somebody forgot to draw.
 */
export function ViewSwitcher({ current }: { current: "mail" | "campaigns" }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
      <Tab href="/mail/all/inbox" label="Mail" active={current === "mail"}>
        <Inbox />
      </Tab>
      <Tab href="/campaigns" label="Campaigns" active={current === "campaigns"}>
        <Megaphone />
      </Tab>
    </div>
  );
}

function Tab({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={label}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors [&_svg]:size-3.5 ${
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
      {label}
    </Link>
  );
}
