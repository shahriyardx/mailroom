"use client";

import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  IconButton,
} from "@/components/kit";
import { authClient } from "@/lib/auth-client";
import { saveAppearanceAction } from "@/server/actions";
import { LogOut, Moon, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Who is signed in, and the two things anybody reaches for from a sidebar.
 *
 * Shared by both shells rather than written twice. It was written twice, and
 * the two drifted: the inbox had an address, a sign-out and a theme toggle,
 * and the campaigns view had a name and a gear — so the same corner of the
 * same app offered different things depending on which half you were in, and
 * signing out was only possible from one of them.
 */
export function SidebarAccount({
  user,
  settingsHref = "/settings",
}: {
  user: { name: string; email: string };
  settingsHref?: string;
}) {
  const router = useRouter();

  return (
    <div className="flex shrink-0 items-center gap-1 px-2.5 pb-2.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
          >
            <Avatar size="sm" name={user.name} address={user.email} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium">{user.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-60">
          <DropdownMenuLabel className="normal-case tracking-normal">
            <span className="block truncate text-[13px] font-medium text-foreground">
              {user.name}
            </span>
            <span className="block truncate font-mono text-[11px] font-normal text-muted-foreground">
              {user.email}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={settingsHref}>
              <Settings /> Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={async () => {
              await authClient.signOut();
              router.push("/sign-in");
              router.refresh();
            }}
          >
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Hint label="Settings" side="top">
        <IconButton size="md" label="Settings" asChild>
          <Link href={settingsHref}>
            <Settings />
          </Link>
        </IconButton>
      </Hint>
      <ThemeToggle />
    </div>
  );
}

/**
 * Light and dark, without a trip to settings.
 *
 * Read from the class the boot script already put on the document, so it
 * agrees with what is on screen rather than with a default it guessed. The
 * choice is written where Settings reads it, so the two never disagree.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  return (
    <Hint label={dark ? "Light theme" : "Dark theme"} side="top">
      <IconButton
        size="md"
        label={dark ? "Light theme" : "Dark theme"}
        onClick={() => {
          const next = !dark;
          setDark(next);
          document.documentElement.classList.toggle("dark", next);
          localStorage.setItem("theme", next ? "dark" : "light");
          void saveAppearanceAction({ theme: next ? "dark" : "light" });
        }}
      >
        {dark ? <Sun /> : <Moon />}
      </IconButton>
    </Hint>
  );
}
