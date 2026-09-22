"use client";

import {
  Avatar,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  IconButton,
  Input,
  Separator,
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
import { emptyTrashAction, saveAppearanceAction } from "@/server/actions";
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  FileText,
  Globe,
  Inbox,
  Layers,
  LogOut,
  Menu,
  Moon,
  PanelLeft,
  PanelLeftClose,
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
import { VersionNote } from "./version-note";

const FOLDER_ICONS: Record<ViewFolder, typeof Inbox> = {
  inbox: Inbox,
  starred: Star,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  spam: ShieldAlert,
  trash: Trash2,
};

/** Where the sidebar remembers whether it was shrunk to a rail. */
export const RAIL_COOKIE = "mailroom.rail";

/** What this device last said, or null on the server and before any choice. */
function readRail(): boolean | null {
  if (typeof document === "undefined") return null;
  const saved = document.cookie.match(/(?:^|;\s*)mailroom\.rail=([01])/);
  return saved ? saved[1] === "1" : null;
}

function writeRail(value: boolean) {
  document.cookie = `${RAIL_COOKIE}=${value ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
}

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
  /** The list this conversation was opened from, for the way back. */
  backHref?: string;
  /** Whether to offer the first address. A 404 for anyone who may not add one. */
  canAddMailbox?: boolean;
  /** The settings screen this reader may open, resolved so the gear does not
   * bounce through a redirect. */
  settingsHref?: string;
  /** How the sidebar was left last time, read from a cookie so the first
   * paint is already the right width. */
  initialRailed?: boolean;
  /**
   * Side by side, or one thing at a time. Stacked gives the whole width to
   * whichever of the two you are looking at, the way a phone always has.
   */
  readingLayout?: "split" | "stacked";
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
  backHref,
  canAddMailbox = false,
  settingsHref = "/settings",
  initialRailed = false,
  readingLayout = "split",
}: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const unreadOnly = params.get("unread") === "1";
  const router = useRouter();
  const composer = useComposer();

  const [counts, setCounts] = useState<Counts>({ folders: {}, mailboxes: {} });

  /**
   * The sidebar can shrink to a rail of icons. A cookie rather than local
   * storage, so the server renders the width the reader left it at instead of
   * a wide sidebar that snaps narrow once the script runs.
   */
  /**
   * Moving between folders replaces this whole subtree, and the payload that
   * replaces it may have been prefetched before the sidebar was collapsed.
   * Read the cookie while the first render is being worked out rather than in
   * an effect afterwards: an effect is one paint too late, and that paint is a
   * full-width sidebar sliding shut on every folder you open.
   */
  const [railed, setRailed] = useState(() => readRail() ?? initialRailed);

  // First visit on this device: seed the mirror from what was saved.
  useEffect(() => {
    if (readRail() === null && initialRailed) writeRail(true);
  }, [initialRailed]);

  /** Whether the two panes take turns instead of sitting side by side. */
  const stacked = readingLayout === "stacked";

  const toggleRail = useCallback(() => {
    const next = !railed;
    setRailed(next);
    // Written twice on purpose: the cookie so the next page is the right width
    // from its first paint, the row so the choice is there on another device.
    writeRail(next);
    void saveAppearanceAction({ navCollapsed: next });
  }, [railed]);

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

  const navPanel = (rail: boolean) => (
    <NavPanel
      folder={folder}
      scope={scope}
      activeKey={activeKey}
      activeLabel={activeLabel}
      unreadOnly={unreadOnly}
      counts={counts}
      domains={domains}
      mailboxes={mailboxes}
      canAddMailbox={canAddMailbox}
      settingsHref={settingsHref}
      labels={labels}
      user={user}
      composer={composer}
      router={router}
      railed={rail}
      onToggleRail={toggleRail}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-card">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* ------------------------------------------------------------ */}
        {/* Navigation: everything you can switch between, named, in one */}
        {/* list. Fixed on a wide screen, a drawer on a narrow one.      */}
        {/* ------------------------------------------------------------ */}
        <aside
          className={cn(
            "hidden shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-150 md:flex",
            railed ? "w-[3.75rem]" : "w-[15rem]",
          )}
        >
          {navPanel(railed)}
        </aside>

        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="flex flex-col bg-sidebar p-0" showClose={false}>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {/* The drawer is already a deliberate act, so it is never a rail. */}
            {navPanel(false)}
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

            <span className="ml-auto" />

            {folder === "trash" && (
              <EmptyTrashButton scope={scope} onDone={() => router.refresh()} />
            )}

            <Hint label="Refresh">
              <IconButton
                size="md"
                label="Refresh"
                className="shrink-0"
                onClick={() => router.refresh()}
              >
                <RefreshCw />
              </IconButton>
            </Hint>
          </header>

          <div className="flex min-h-0 flex-1">
            <section
              className={cn(
                "w-full min-w-0 flex-col",
                stacked
                  ? threadOpen
                    ? "hidden"
                    : "flex"
                  : [
                      "lg:flex lg:w-[24.5rem] lg:shrink-0 lg:border-r lg:border-border xl:w-[26.5rem]",
                      threadOpen ? "hidden" : "flex",
                    ],
              )}
            >
              {/* The list starts here. An All/Unread switch sat above it, and
                  All is the answer almost every time — a row of chrome to say
                  so cost a message on every screen it was on. Unread is still
                  a URL: ?unread=1. */}
              <div className="min-h-0 flex-1 overflow-hidden">{list}</div>
            </section>

            <section
              className={cn(
                "min-w-0 flex-1 flex-col",
                stacked
                  ? threadOpen
                    ? "flex"
                    : "hidden"
                  : ["lg:flex", threadOpen ? "flex" : "hidden"],
              )}
            >
              {openSubject && (
                <div
                  className={cn(
                    "flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2",
                    !stacked && "lg:hidden",
                  )}
                >
                  {backHref && (
                    <IconButton size="sm" label="Back to the list" asChild>
                      <Link href={backHref}>
                        <ArrowLeft />
                      </Link>
                    </IconButton>
                  )}
                  <p className="min-w-0 truncate text-[12.5px] text-muted-foreground">
                    {openSubject}
                  </p>
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
  unreadOnly,
  counts,
  domains,
  mailboxes,
  canAddMailbox,
  settingsHref,
  labels,
  user,
  composer,
  router,
  railed,
  onToggleRail,
}: {
  folder: ViewFolder;
  scope: Scope;
  activeKey: string;
  activeLabel: string | null;
  /** Whether the open folder is filtered to unread, so the sub-row can say so. */
  unreadOnly: boolean;
  counts: Counts;
  domains: [string, Mailbox[]][];
  mailboxes: Mailbox[];
  canAddMailbox: boolean;
  settingsHref: string;
  labels: LabelRow[];
  user: { name: string; email: string };
  composer: ReturnType<typeof useComposer>;
  router: ReturnType<typeof useRouter>;
  /** Shrunk to a column of icons, with every word hidden behind a tooltip. */
  railed: boolean;
  onToggleRail: () => void;
}) {
  if (railed) {
    return (
      <NavRail
        folder={folder}
        scope={scope}
        activeLabel={activeLabel}
        counts={counts}
        settingsHref={settingsHref}
        labels={labels}
        user={user}
        composer={composer}
        router={router}
        onToggleRail={onToggleRail}
      />
    );
  }

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-1 px-4">
        <Wordmark sub={<VersionNote />} className="flex-1" />
        <Hint label="Collapse sidebar" side="right">
          <IconButton
            size="sm"
            label="Collapse sidebar"
            className="-mr-1.5 hidden shrink-0 md:inline-flex"
            onClick={onToggleRail}
          >
            <PanelLeftClose />
          </IconButton>
        </Hint>
      </div>

      {/* Nothing to write from, nothing to offer. */}
      {composer.canWrite && (
        <div className="px-3 pb-4">
          {/* No tooltip: the button says what it is, and c is in the help. */}
          <Button variant="solid" size="md" pill block onClick={() => composer.open()}>
            <PenLine />
            Compose
          </Button>
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

                {/*
                  An All/Unread switch used to sit above the list, where it
                  cost a row of chrome on every screen to say "All", which is
                  the answer almost every time. Here it only exists while the
                  inbox is open, which is the one folder people sort through
                  rather than go to for something in particular.
                */}
                {active && item === "inbox" && (
                  <UnreadSwitch base={scopeHref(scope, item)} unreadOnly={unreadOnly} />
                )}
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
    </>
  );
}

/**
 * The sidebar with every word taken out of it.
 *
 * Only what a single icon can stand for survives: the folders, and the labels
 * as their own colours. Which mailbox you are in does not, because a rail has
 * no room for a tree of domains and the addresses under them — open the
 * sidebar to switch. Every icon says what it is on hover.
 */
function NavRail({
  folder,
  scope,
  activeLabel,
  counts,
  settingsHref,
  labels,
  user,
  composer,
  router,
  onToggleRail,
}: {
  folder: ViewFolder;
  scope: Scope;
  activeLabel: string | null;
  counts: Counts;
  settingsHref: string;
  labels: LabelRow[];
  user: { name: string; email: string };
  composer: ReturnType<typeof useComposer>;
  router: ReturnType<typeof useRouter>;
  onToggleRail: () => void;
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-center">
        <Hint label="Expand sidebar" side="right">
          <IconButton size="md" label="Expand sidebar" onClick={onToggleRail}>
            <PanelLeft />
          </IconButton>
        </Hint>
      </div>

      {composer.canWrite && (
        <div className="flex justify-center pb-4">
          <IconButton size="md" label="Compose" variant="solid" onClick={() => composer.open()}>
            <PenLine />
          </IconButton>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <ul className="space-y-1">
          {FOLDERS.map((item) => {
            const Icon = FOLDER_ICONS[item];
            const count = counts.folders[item] ?? 0;
            return (
              <li key={item}>
                <RailRow
                  href={scopeHref(scope, item)}
                  active={folder === item && !activeLabel}
                  label={count > 0 ? `${FOLDER_LABELS[item]} — ${count}` : FOLDER_LABELS[item]}
                  badge={count > 0}
                >
                  <Icon className="size-[17px]" />
                </RailRow>
              </li>
            );
          })}
        </ul>

        {labels.length > 0 && (
          <>
            <Separator className="my-2.5" />
            <ul className="space-y-1">
              {labels.map((item) => (
                <li key={item.id}>
                  <RailRow
                    href={`${scopeHref(scope, "inbox")}?label=${item.id}`}
                    active={activeLabel === item.id}
                    label={item.name}
                  >
                    <Tag className="size-[17px]" style={{ color: item.color }} />
                  </RailRow>
                </li>
              ))}
            </ul>
          </>
        )}
      </nav>

      <div className="flex shrink-0 flex-col items-center gap-1 pb-2.5">
        <Hint label="Settings" side="right">
          <IconButton size="md" label="Settings" asChild>
            <Link href={settingsHref}>
              <Settings />
            </Link>
          </IconButton>
        </Hint>
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account"
              className="rounded-full p-1 transition-colors hover:bg-sidebar-accent"
            >
              <Avatar size="sm" name={user.name} address={user.email} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-60">
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
      </div>
    </>
  );
}

/**
 * One icon in the rail. The count cannot fit beside it, so anything waiting is
 * a dot on the corner and the number goes in the tooltip.
 */
function RailRow({
  href,
  active,
  label,
  badge,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  badge?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label} side="right">
      <Link
        href={href}
        aria-label={label}
        className={cn(
          "relative flex h-9 items-center justify-center rounded-[10px] transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
      >
        {children}
        {badge && (
          <span
            className="absolute top-1.5 right-1.5 size-[6px] rounded-full bg-primary"
            aria-hidden
          />
        )}
      </Link>
    </Hint>
  );
}

/** One row of the navigation list. Active state is a filled pill, not a border. */
/**
 * All or Unread, as two words under the inbox.
 *
 * This went through a pair of filled rows and then a segmented control, and
 * both were wrong the same way: given a shape and a fill, they read as
 * navigation, and the sidebar appeared to have grown a level it had not. It is
 * a filter on the folder already open, so it is set as plain text — hung off
 * the same kind of trunk the domains and their mailboxes already use.
 */
function UnreadSwitch({ base, unreadOnly }: { base: string; unreadOnly: boolean }) {
  const link = (active: boolean) =>
    cn(
      // The tick is the branch: a short rule out from the trunk to the word.
      "relative block py-0.5 pl-4 transition-colors",
      "before:absolute before:top-[0.85em] before:left-0 before:h-px before:w-2.5 before:bg-sidebar-border",
      active ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <ul className="mt-0.5 mb-1 ml-[19px] border-sidebar-border border-l text-[12px]">
      <li>
        <Link href={base} className={link(!unreadOnly)}>
          All
        </Link>
      </li>
      {/* The trunk stops at the last branch rather than running past it. */}
      <li className="relative before:absolute before:top-[0.85em] before:-left-px before:bottom-0 before:w-px before:bg-sidebar">
        <Link href={`${base}?unread=1`} className={link(unreadOnly)}>
          Unread
        </Link>
      </li>
    </ul>
  );
}

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

/**
 * Clearing the trash. It lives in the header rather than over the list
 * because it acts on the whole folder, not on anything picked out of it.
 */
function EmptyTrashButton({ scope, onDone }: { scope: Scope; onDone: () => void }) {
  const [asking, setAsking] = useState(false);

  return (
    <>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Empty the trash?"
        description="Everything deleted in this view"
        consequences="Those messages and their attachments go for good. A reply of yours still in Sent is left where it is."
        confirmLabel="Empty trash"
        onConfirm={async () => {
          await emptyTrashAction(scope);
          setAsking(false);
          onDone();
        }}
      />
      <Button variant="subtle" size="sm" pill className="shrink-0" onClick={() => setAsking(true)}>
        <Trash2 className="size-3.5" />
        <span className="hidden sm:inline">Empty trash</span>
      </Button>
    </>
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
          // Settings offers the same choice, so this writes where that reads.
          void saveAppearanceAction({ theme: next ? "dark" : "light" });
        }}
      >
        {dark ? <Sun /> : <Moon />}
      </IconButton>
    </Hint>
  );
}
