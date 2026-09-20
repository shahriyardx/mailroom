"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { cn, colorOf, initialsOf } from "@/lib/utils";
import {
  Archive,
  ChevronRight,
  FileText,
  Globe,
  Inbox,
  Layers,
  LogOut,
  Mails,
  Moon,
  PenLine,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Star,
  Sun,
  Tag,
  Trash2,
  X,
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

interface Props {
  mailboxes: Mailbox[];
  labels: LabelRow[];
  scope: Scope;
  folder: ViewFolder;
  scopeLabel: string;
  threadCount: number;
  user: { name: string; email: string };
  list: React.ReactNode;
  children: React.ReactNode;
  openSubject?: string;
}

export function MailShell({
  mailboxes,
  labels,
  scope,
  folder,
  scopeLabel,
  threadCount,
  user,
  list,
  children,
  openSubject,
}: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const composer = useComposer();

  const [counts, setCounts] = useState<{
    folders: Record<string, number>;
    mailboxes: Record<string, number>;
  }>({ folders: {}, mailboxes: {} });

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
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
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
        composer.open();
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

  const activeKey = scopeKey(scope);
  const unreadOnly = params.get("unread") === "1";
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

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* ---------------------------------------------------------------- */}
      {/* Navigation: everything you can switch between, named, in one list */}
      {/* ---------------------------------------------------------------- */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          <span className="grid size-7 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Mails className="size-4" />
          </span>
          <span className="font-heading text-[15px] tracking-[-0.02em]">
            <span className="font-semibold">post</span>
            <span className="text-muted-foreground"> mail</span>
          </span>
        </div>

        <div className="px-3 pb-3">
          <Button
            className="h-10 w-full justify-center gap-2 rounded-full font-medium text-[13px]"
            onClick={() => composer.open()}
          >
            <PenLine className="size-4" />
            Compose
          </Button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <p className="eyebrow px-2 pt-2 pb-1.5">menu</p>
          <ul className="space-y-0.5">
            {FOLDERS.map((item) => {
              const Icon = FOLDER_ICONS[item];
              const count = counts.folders[item] ?? 0;
              const active = folder === item && !activeLabel;
              return (
                <li key={item}>
                  <NavRow href={scopeHref(scope, item)} active={active}>
                    <Icon className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{FOLDER_LABELS[item]}</span>
                    {count > 0 && (
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[10.5px] tabular-nums",
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

          <p className="eyebrow px-2 pt-5 pb-1.5">mailboxes</p>
          <ul className="space-y-0.5">
            <li>
              <NavRow href={scopeHref({ kind: "all" }, folder)} active={activeKey === "all"}>
                <Layers className="size-4 shrink-0" />
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
              <li className="px-2 py-1.5 text-[12px] text-muted-foreground">
                None yet.{" "}
                <Link href="/settings/mailboxes" className="text-primary hover:underline">
                  Add one
                </Link>
              </li>
            )}
          </ul>

          {labels.length > 0 && (
            <>
              <p className="eyebrow px-2 pt-5 pb-1.5">labels</p>
              <ul className="space-y-0.5">
                {labels.map((item) => (
                  <li key={item.id}>
                    <NavRow
                      href={`${scopeHref(scope, "inbox")}?label=${item.id}`}
                      active={activeLabel === item.id}
                    >
                      <Tag className="size-4 shrink-0" style={{ color: item.color }} />
                      <span className="flex-1 truncate">{item.name}</span>
                    </NavRow>
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>

        <div className="flex shrink-0 items-center gap-1 border-t px-2 py-2">
          <ThemeToggle />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-lg text-muted-foreground"
                  nativeButton={false}
                  render={<Link href="/settings" />}
                >
                  <Settings className="size-4" />
                </Button>
              }
            />
            <TooltipContent side="top" className="font-mono text-[11px]">
              Settings
            </TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="ml-auto h-8 min-w-0 gap-2 rounded-full px-1.5 pr-3"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary font-mono text-[10px] font-semibold text-secondary-foreground">
                    {initialsOf(user.name || user.email)}
                  </span>
                  <span className="truncate text-[12px]">{user.name}</span>
                </Button>
              }
            />
            <DropdownMenuContent side="top" align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate font-medium text-[13px]">{user.name}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {user.email}
                  </p>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/settings" />}>
                <Settings /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  await authClient.signOut();
                  router.push("/sign-in");
                  router.refresh();
                }}
              >
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* ---------------------------------------------------------------- */}
      {/* Work area: search on top, list beside the open conversation      */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <SearchField defaultValue={searchValue} onCommit={(value) => setParam("q", value)} />

          {searchValue && (
            <button
              type="button"
              onClick={() => setParam("q", null)}
              className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            >
              {searchValue}
              <X className="size-3" />
            </button>
          )}

          <Tooltip>
            <TooltipTrigger
              render={
                // biome-ignore lint/a11y/noLabelWithoutControl: the Switch is the nested control
                <label className="flex shrink-0 items-center gap-2">
                  <span className="eyebrow">unread</span>
                  <Switch
                    checked={unreadOnly}
                    onCheckedChange={(on: boolean) => setParam("unread", on ? "1" : null)}
                  />
                </label>
              }
            />
            <TooltipContent side="bottom" className="font-mono text-[11px]">
              Show unread only
            </TooltipContent>
          </Tooltip>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="flex w-full min-w-0 flex-col border-r lg:w-[27rem] lg:shrink-0">
            <div className="min-h-0 flex-1 overflow-hidden">{list}</div>
          </section>

          <section className="hidden min-w-0 flex-1 flex-col lg:flex">
            {openSubject && (
              <div className="flex h-9 shrink-0 items-center border-b px-4">
                <p className="truncate text-[12.5px] text-muted-foreground">{openSubject}</p>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          </section>
        </div>

        <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-statusbar px-4 font-mono text-[10px] text-muted-foreground">
          <span>{mailboxes.length} mailboxes</span>
          <span className="opacity-40">|</span>
          <span>{domains.length} domains</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="kbd">c</span> compose
            <span className="kbd">/</span> search
            <span className="kbd">g</span> then folder
          </span>
        </footer>
      </div>
    </div>
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
        "flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13px] transition-colors",
        active
          ? "bg-primary/12 font-medium text-primary"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground",
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
          className="rounded-md p-1 text-muted-foreground hover:text-foreground"
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
              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground tabular-nums">
                {domainUnread}
              </span>
            )}
          </NavRow>
        </div>
      </div>

      {open && (
        <ul className="mt-0.5 ml-4 space-y-0.5 border-l pl-2">
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
                    <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground tabular-nums">
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
    <div className="relative min-w-0 max-w-xl flex-1">
      <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3.5 size-4 text-muted-foreground" />
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
        placeholder="Search mail"
        className="h-9 rounded-full bg-muted/60 pl-10 text-[13px] shadow-none"
      />
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg text-muted-foreground"
            onClick={() => {
              const next = !dark;
              setDark(next);
              document.documentElement.classList.toggle("dark", next);
              localStorage.setItem("theme", next ? "dark" : "light");
            }}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        }
      />
      <TooltipContent side="top" className="font-mono text-[11px]">
        {dark ? "Light theme" : "Dark theme"}
      </TooltipContent>
    </Tooltip>
  );
}
