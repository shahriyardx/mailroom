"use client";

import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  IconButton,
  Input,
  Sheet,
  SheetContent,
  SheetTitle,
  Wordmark,
} from "@/components/kit";
import type { Label as LabelRow, Mailbox } from "@/db/schema";
import { authClient } from "@/lib/auth-client";
import {
  FOLDERS,
  FOLDER_LABELS,
  type Scope,
  type ViewFolder,
  scopeHref,
  scopeKey,
} from "@/lib/scope";
import { cn, colorOf } from "@/lib/utils";
import {
  Archive,
  ChevronRight,
  FileText,
  Globe,
  Inbox,
  Layers,
  LogOut,
  Menu,
  Moon,
  PenLine,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Star,
  Sun,
  Tag,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useComposer } from "./composer-provider";

const FOLDER_ICONS: Record<ViewFolder, typeof Inbox> = {
  inbox: Inbox,
  starred: Star,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  spam: ShieldAlert,
  trash: Trash2,
};

interface Counts {
  folders: Record<string, number>;
  mailboxes: Record<string, number>;
}

interface Props {
  mailboxes: Mailbox[];
  labels: LabelRow[];
  scope: Scope;
  folder: ViewFolder;
  user: { name: string; email: string };
  list: React.ReactNode;
  children: React.ReactNode;
  openSubject?: string;
  /** True when a conversation is open, which takes over the screen on mobile. */
  threadOpen?: boolean;
  /** Whether to offer the first address. A 404 for anyone who may not add one. */
  canAddMailbox?: boolean;
}

export function MailShell({
  mailboxes,
  labels,
  scope,
  folder,
  user,
  list,
  children,
  openSubject,
  threadOpen = false,
  canAddMailbox = false,
}: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const composer = useComposer();

  const [counts, setCounts] = useState<Counts>({ folders: {}, mailboxes: {} });

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/counts?path=${encodeURIComponent(pathname)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data && !cancelled) setCounts(data);
        })
        .catch(() => {});

    load();

    // The live stream drives this; the interval is only a fallback for when
    // it cannot connect at all.
    const timer = setInterval(load, 120_000);
    window.addEventListener("mailroom:refresh", load);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("mailroom:refresh", load);
    };
  }, [pathname]);

  // Global shortcuts: c composes, g then a letter jumps folders.
  useEffect(() => {
    let lastKey = "";
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "c") {
        event.preventDefault();
        if (composer.canWrite) composer.open();
      } else if (lastKey === "g") {
        const jump: Record<string, ViewFolder> = {
          i: "inbox",
          s: "sent",
          d: "drafts",
          a: "archive",
          t: "trash",
          u: "starred",
        };
        const next = jump[event.key];
        if (next) {
          event.preventDefault();
          router.push(scopeHref(scope, next));
        }
      }
      lastKey = event.key;
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composer, router, scope]);

  const domains = useMemo(() => {
    const map = new Map<string, Mailbox[]>();
    for (const box of mailboxes) map.set(box.domain, [...(map.get(box.domain) ?? []), box]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [mailboxes]);

  const [navOpen, setNavOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer on navigation
  useEffect(() => setNavOpen(false), [pathname, params]);

  const activeKey = scopeKey(scope);
  const searchValue = params.get("q") ?? "";
  const activeLabel = params.get("label");

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("cursor");
      next.delete("t");
      router.push(`${pathname}${next.size ? `?${next}` : ""}`);
    },
    [params, pathname, router],
  );

  const nav = (
    <NavPanel
      folder={folder}
      scope={scope}
      activeKey={activeKey}
      activeLabel={activeLabel}
      counts={counts}
      domains={domains}
      mailboxes={mailboxes}
      canAddMailbox={canAddMailbox}
      labels={labels}
      user={user}
      composer={composer}
      router={router}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-card">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* ------------------------------------------------------------ */}
        {/* Navigation: everything you can switch between, named, in one */}
        {/* list. Fixed on a wide screen, a drawer on a narrow one.      */}
        {/* ------------------------------------------------------------ */}
        <aside className="hidden w-[15rem] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
          {nav}
        </aside>

        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="flex flex-col bg-sidebar p-0" showClose={false}>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {nav}
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* One row across both columns, holding the two things that apply
              to whatever is below it: what to search for, and reloading. */}
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 sm:px-5">
            <IconButton
              size="md"
              label="Open navigation"
              className="-ml-1.5 md:hidden"
              onClick={() => setNavOpen(true)}
            >
              <Menu />
            </IconButton>
            {/* No name for the view here. The sidebar already has the folder
                lit up and the mailbox chosen, and repeating it in the header
                spends the only row this pane has on something you can see
                without it. The row goes to search instead. */}
            <div className="min-w-0 flex-1 md:max-w-[28rem]">
              <SearchField defaultValue={searchValue} onCommit={(value) => setParam("q", value)} />
            </div>

            <Hint label="Refresh">
              <IconButton
                size="md"
                label="Refresh"
                className="ml-auto shrink-0"
                onClick={() => router.refresh()}
              >
                <RefreshCw />
              </IconButton>
            </Hint>
          </header>

          <div className="flex min-h-0 flex-1">
            <section
              className={cn(
                "w-full min-w-0 flex-col lg:flex lg:w-[24.5rem] lg:shrink-0 lg:border-r lg:border-border xl:w-[26.5rem]",
                threadOpen ? "hidden" : "flex",
              )}
            >
              {/* The list starts here. An All/Unread switch sat above it, and
                  All is the answer almost every time — a row of chrome to say
                  so cost a message on every screen it was on. Unread is still
                  a URL: ?unread=1. */}
              <div className="min-h-0 flex-1 overflow-hidden">{list}</div>
            </section>

            <section
              className={cn("min-w-0 flex-1 flex-col lg:flex", threadOpen ? "flex" : "hidden")}
            >
              {openSubject && (
                <div className="flex h-10 shrink-0 items-center border-b border-border px-4 lg:hidden">
                  <p className="truncate text-[12.5px] text-muted-foreground">{openSubject}</p>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavPanel({
  folder,
  scope,
  activeKey,
  activeLabel,
  counts,
  domains,
  mailboxes,
  canAddMailbox,
  labels,
  user,
  composer,
  router,
}: {
  folder: ViewFolder;
  scope: Scope;
  activeKey: string;
  activeLabel: string | null;
  counts: Counts;
  domains: [string, Mailbox[]][];
  mailboxes: Mailbox[];
  canAddMailbox: boolean;
  labels: LabelRow[];
  user: { name: string; email: string };
  composer: ReturnType<typeof useComposer>;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center px-4">
        <Wordmark />
      </div>

      {/* Nothing to write from, nothing to offer. */}
      {composer.canWrite && (
        <div className="px-3 pb-4">
          <Hint label="Compose — c" side="right">
            <Button variant="solid" size="md" pill block onClick={() => composer.open()}>
              <PenLine />
              Compose
            </Button>
          </Hint>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        <ul className="space-y-0.5">
          {FOLDERS.map((item) => {
            const Icon = FOLDER_ICONS[item];
            const count = counts.folders[item] ?? 0;
            const active = folder === item && !activeLabel;
            return (
              <li key={item}>
                <NavRow href={scopeHref(scope, item)} active={active}>
                  <Icon className="size-[17px] shrink-0" />
                  <span className="flex-1 truncate">{FOLDER_LABELS[item]}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "shrink-0 font-mono text-[11px] tabular-nums",
                        active ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </NavRow>
              </li>
            );
          })}
        </ul>

        <p className="eyebrow px-2 pt-6 pb-1.5">Mailboxes</p>
        <ul className="space-y-0.5">
          <li>
            <NavRow href={scopeHref({ kind: "all" }, folder)} active={activeKey === "all"}>
              <Layers className="size-[17px] shrink-0" />
              <span className="flex-1 truncate">All mail</span>
            </NavRow>
          </li>
          {domains.map(([domain, boxes]) => (
            <DomainBranch
              key={domain}
              domain={domain}
              boxes={boxes}
              folder={folder}
              activeKey={activeKey}
              unread={counts.mailboxes}
            />
          ))}
          {mailboxes.length === 0 && (
            <li className="px-2 py-1.5 text-[12.5px] text-muted-foreground">
              None yet.{" "}
              {canAddMailbox && (
                <Link href="/settings/mailboxes" className="text-primary hover:underline">
                  Add one
                </Link>
              )}
            </li>
          )}
        </ul>

        {labels.length > 0 && (
          <>
            <p className="eyebrow px-2 pt-6 pb-1.5">Labels</p>
            <ul className="space-y-0.5">
              {labels.map((item) => (
                <li key={item.id}>
                  <NavRow
                    href={`${scopeHref(scope, "inbox")}?label=${item.id}`}
                    active={activeLabel === item.id}
                  >
                    <Tag className="size-[17px] shrink-0" style={{ color: item.color }} />
                    <span className="flex-1 truncate">{item.name}</span>
                  </NavRow>
                </li>
              ))}
            </ul>
          </>
        )}
      </nav>

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
                <span className="block truncate text-[11px] text-muted-foreground">
                  {user.email}
                </span>
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
              <Link href="/settings">
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
            <Link href="/settings">
              <Settings />
            </Link>
          </IconButton>
        </Hint>
        <ThemeToggle />
      </div>
    </>
  );
}

/** One row of the navigation list. Active state is a filled pill, not a border. */
function NavRow({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13px] transition-colors",
        active
          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

/** A domain and the mailboxes under it, expanded while it is the active scope. */
function DomainBranch({
  domain,
  boxes,
  folder,
  activeKey,
  unread,
}: {
  domain: string;
  boxes: Mailbox[];
  folder: ViewFolder;
  activeKey: string;
  unread: Record<string, number>;
}) {
  const isActive = activeKey === `d:${domain}` || boxes.some((box) => activeKey === `m:${box.id}`);
  const [open, setOpen] = useState(isActive);

  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  const domainUnread = boxes.reduce((sum, box) => sum + (unread[box.id] ?? 0), 0);

  return (
    <li>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? `Collapse ${domain}` : `Expand ${domain}`}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        </button>
        <div className="min-w-0 flex-1">
          <NavRow
            href={scopeHref({ kind: "domain", domain }, folder)}
            active={activeKey === `d:${domain}`}
          >
            <Globe className="size-4 shrink-0" style={{ color: colorOf(domain) }} />
            <span className="flex-1 truncate">{domain}</span>
            {domainUnread > 0 && (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                {domainUnread}
              </span>
            )}
          </NavRow>
        </div>
      </div>

      {open && (
        <ul className="mt-0.5 ml-4 space-y-0.5 border-l border-sidebar-border pl-2">
          {boxes.map((box) => {
            const count = unread[box.id] ?? 0;
            return (
              <li key={box.id}>
                <NavRow
                  href={scopeHref({ kind: "mailbox", mailboxId: box.id }, folder)}
                  active={activeKey === `m:${box.id}`}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: box.color }}
                    aria-hidden
                  />
                  <span className="flex-1 truncate font-mono text-[12px]">
                    {box.address.split("@")[0]}
                  </span>
                  {count > 0 && (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                      {count}
                    </span>
                  )}
                </NavRow>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function SearchField({
  defaultValue,
  onCommit,
}: {
  defaultValue: string;
  onCommit: (value: string | null) => void;
}) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => setValue(defaultValue), [defaultValue]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (typing || event.metaKey || event.ctrlKey) return;
      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("mail-search")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative">
      <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground" />
      <Input
        id="mail-search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit(value.trim() || null);
          if (event.key === "Escape") {
            setValue("");
            onCommit(null);
          }
        }}
        placeholder="Search"
        className="h-9 rounded-xl pr-3 pl-9 text-[13px] md:pr-9"
      />
      {/* The shortcut lives where you look for the field, not in a status
          bar — and not at all on a phone, which has no key to press. */}
      <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2.5 hidden md:block">
        <span className="kbd">/</span>
      </span>
    </div>
  );
}

function ThemeToggle() {
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
        }}
      >
        {dark ? <Sun /> : <Moon />}
      </IconButton>
    </Hint>
  );
}
