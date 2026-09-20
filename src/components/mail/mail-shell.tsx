"use client";

import { Badge } from "@/components/ui/badge";
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
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
  Check,
  ChevronsUpDown,
  FileText,
  Globe,
  Inbox,
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
    <SidebarProvider
      style={{ "--sidebar-width": "23rem" } as React.CSSProperties}
      className="h-dvh overflow-hidden"
    >
      <Sidebar collapsible="icon" className="overflow-hidden *:data-[sidebar=sidebar]:flex-row">
        {/* ---- Icon rail: folders ---- */}
        <Sidebar
          collapsible="none"
          className="w-[calc(var(--sidebar-width-icon)+1px)] border-r bg-rail"
        >
          <SidebarHeader className="items-center border-b p-0">
            <Link
              href="/mail/all/inbox"
              className="grid size-12 place-items-center text-primary"
              aria-label="Mail home"
            >
              <Mails className="size-[18px]" />
            </Link>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup className="p-0 py-1.5">
              <SidebarGroupContent>
                <SidebarMenu className="items-center gap-0.5">
                  {FOLDERS.map((item) => {
                    const Icon = FOLDER_ICONS[item];
                    const active = folder === item;
                    const count = counts.folders[item] ?? 0;
                    return (
                      <SidebarMenuItem key={item}>
                        <SidebarMenuButton
                          render={<Link href={scopeHref(scope, item)} />}
                          isActive={active}
                          tooltip={{
                            children: (
                              <span className="font-mono text-[11px]">
                                {FOLDER_LABELS[item]}
                                {count > 0 && <span className="ml-1.5 opacity-60">{count}</span>}
                              </span>
                            ),
                            side: "right",
                          }}
                          className={cn(
                            "relative size-9 justify-center rounded-xl p-0",
                            active &&
                              "bg-primary/12 text-primary hover:bg-primary/16 hover:text-primary",
                          )}
                        >
                          <Icon className="size-[17px]" />
                          {count > 0 && (
                            <span
                              className={cn(
                                "absolute top-1 right-1 size-1.5 rounded-full",
                                active ? "bg-primary" : "bg-muted-foreground/70",
                              )}
                            />
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="items-center gap-0.5 border-t py-2">
            <ThemeToggle />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 rounded-xl text-muted-foreground"
                    nativeButton={false}
                    render={<Link href="/settings" />}
                  >
                    <Settings className="size-[17px]" />
                  </Button>
                }
              />
              <TooltipContent side="right" className="font-mono text-[11px]">
                Settings
              </TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" className="size-9 rounded-xl">
                    <span className="grid size-6 place-items-center rounded-lg bg-secondary font-mono text-[10px] font-semibold text-secondary-foreground">
                      {initialsOf(user.name || user.email)}
                    </span>
                  </Button>
                }
              />
              <DropdownMenuContent side="right" align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="font-normal">
                    <p className="truncate text-[13px] font-medium">{user.name}</p>
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
          </SidebarFooter>
        </Sidebar>

        {/* ---- List panel: scope, search, threads ---- */}
        <Sidebar collapsible="none" className="hidden min-w-0 flex-1 md:flex">
          <SidebarHeader className="gap-0 border-b p-0">
            <div className="flex items-center gap-1 px-2.5 py-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      className="h-8 min-w-0 flex-1 justify-start gap-2 px-1.5 hover:bg-sidebar-accent"
                    >
                      <span
                        className="size-2 shrink-0 rounded-md"
                        style={{
                          background:
                            scope.kind === "all"
                              ? "var(--muted-foreground)"
                              : scope.kind === "domain"
                                ? colorOf(scope.domain)
                                : (mailboxes.find((box) => box.id === scope.mailboxId)?.color ??
                                  "var(--primary)"),
                        }}
                      />
                      <span className="truncate font-mono text-[12px]">{scopeLabel}</span>
                      <ChevronsUpDown className="ml-auto size-3.5 shrink-0 opacity-50" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" className="w-72">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="eyebrow">Scope</DropdownMenuLabel>
                    <DropdownMenuItem render={<Link href={scopeHref({ kind: "all" }, folder)} />}>
                      <Mails />
                      <span className="flex-1">All mail</span>
                      {activeKey === "all" && <Check className="size-3.5 text-primary" />}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>

                  {domains.map(([domain, boxes]) => (
                    <DropdownMenuGroup key={domain}>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        render={<Link href={scopeHref({ kind: "domain", domain }, folder)} />}
                      >
                        <Globe style={{ color: colorOf(domain) }} />
                        <span className="flex-1 font-mono text-[12px]">{domain}</span>
                        {activeKey === `d:${domain}` && <Check className="size-3.5 text-primary" />}
                      </DropdownMenuItem>
                      {boxes.map((box) => (
                        <DropdownMenuItem
                          key={box.id}
                          className="pl-7"
                          render={
                            <Link
                              href={scopeHref({ kind: "mailbox", mailboxId: box.id }, folder)}
                            />
                          }
                        >
                          <span
                            className="size-1.5 rounded-full"
                            style={{ background: box.color }}
                          />
                          <span className="flex-1 truncate font-mono text-[12px]">
                            {box.address}
                          </span>
                          {(counts.mailboxes[box.id] ?? 0) > 0 && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {counts.mailboxes[box.id]}
                            </span>
                          )}
                          {activeKey === `m:${box.id}` && (
                            <Check className="size-3.5 text-primary" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  ))}

                  {labels.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="eyebrow">Labels</DropdownMenuLabel>
                        {labels.map((item) => (
                          <DropdownMenuItem
                            key={item.id}
                            render={<Link href={`${scopeHref(scope, "inbox")}?label=${item.id}`} />}
                          >
                            <span
                              className="size-2 rounded-md"
                              style={{ background: item.color }}
                            />
                            <span className="flex-1 truncate">{item.name}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-[12px]"
                onClick={() => composer.open()}
              >
                <PenLine className="size-3.5" />
                Compose
              </Button>
            </div>

            <div className="flex items-center gap-2 border-t px-2.5 py-2">
              <SearchField defaultValue={searchValue} onCommit={(value) => setParam("q", value)} />
              <Tooltip>
                <TooltipTrigger
                  render={
                    // biome-ignore lint/a11y/noLabelWithoutControl: the Switch is the nested control
                    <label className="flex shrink-0 items-center gap-1.5">
                      <span className="eyebrow">Unread</span>
                      <Switch
                        checked={unreadOnly}
                        onCheckedChange={(on: boolean) => setParam("unread", on ? "1" : null)}
                        className="scale-90"
                      />
                    </label>
                  }
                />
                <TooltipContent side="bottom" className="font-mono text-[11px]">
                  Show unread only
                </TooltipContent>
              </Tooltip>
            </div>
          </SidebarHeader>

          <SidebarContent className="min-h-0">{list}</SidebarContent>
        </Sidebar>
      </Sidebar>

      <SidebarInset className="flex min-w-0 flex-col overflow-hidden">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-card px-3">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[12px]">
            <span className="font-mono text-muted-foreground">{scopeLabel}</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="font-medium">{FOLDER_LABELS[folder]}</span>
            {openSubject && (
              <>
                <span className="text-muted-foreground/40">/</span>
                <span className="truncate text-muted-foreground">{openSubject}</span>
              </>
            )}
          </nav>

          {searchValue && (
            <Badge variant="secondary" className="h-5 gap-1 font-mono text-[10px]">
              q: {searchValue}
              <button type="button" onClick={() => setParam("q", null)} aria-label="Clear search">
                <X className="size-3" />
              </button>
            </Badge>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

        {/* Status bar: the same habit as an IDE — always know what you are looking at. */}
        <footer className="flex h-6 shrink-0 items-center gap-3 border-t bg-statusbar px-3 font-mono text-[10px] text-muted-foreground">
          <span>{mailboxes.length} mailboxes</span>
          <span className="opacity-40">|</span>
          <span>{domains.length} domains</span>
          <span className="opacity-40">|</span>
          <span>
            {threadCount} in {FOLDER_LABELS[folder].toLowerCase()}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <span className="kbd">c</span> compose
            <span className="kbd">/</span> search
            <span className="kbd">g</span> then folder
          </span>
        </footer>
      </SidebarInset>
    </SidebarProvider>
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
    <div className="relative min-w-0 flex-1">
      <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
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
        className="h-7 rounded-xl pl-7 font-mono text-[12px]"
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
            className="size-9 rounded-xl text-muted-foreground"
            onClick={() => {
              const next = !dark;
              setDark(next);
              document.documentElement.classList.toggle("dark", next);
              localStorage.setItem("theme", next ? "dark" : "light");
            }}
          >
            {dark ? <Sun className="size-[17px]" /> : <Moon className="size-[17px]" />}
          </Button>
        }
      />
      <TooltipContent side="right" className="font-mono text-[11px]">
        {dark ? "Light theme" : "Dark theme"}
      </TooltipContent>
    </Tooltip>
  );
}
