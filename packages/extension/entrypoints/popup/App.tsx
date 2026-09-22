import { Button, EmptyState, IconButton, RowSkeleton } from "@/components/kit";
import { MailboxPicker } from "@/components/mailbox-picker";
import { ThreadRow } from "@/components/thread-row";
import { ThreadView } from "@/components/thread-view";
import {
  ApiError,
  type ThreadPatch,
  deleteThread,
  getThread,
  listMailboxes,
  listThreads,
  patchThread,
} from "@/lib/api";
import { cacheList, cacheMailboxes, cachedList, cachedMailboxes } from "@/lib/cache";
import { cx } from "@/lib/format";
import { openTab, refreshBadge, useDebounced, useSettings, useTheme } from "@/lib/hooks";
import { isConnected, watchesNothing } from "@/lib/settings";
import {
  type ApiMailbox,
  type ApiThread,
  VIEWS,
  VIEW_FOLDER,
  VIEW_LABEL,
  type View,
} from "@/lib/types";
import {
  Archive,
  ExternalLink,
  Inbox,
  MailOpen,
  Mailbox as MailboxIcon,
  Maximize2,
  Plug,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

/**
 * The popup.
 *
 * One page that is either 400 pixels of toolbar or a full tab, and the only
 * difference between the two is whether the list and the conversation sit
 * side by side. Everything else — the views, the triage, the search — is the
 * same code, because a second layout is a second set of bugs.
 */

const PAGE = 25;

export function App({ inTab }: { inTab: boolean }) {
  const { settings, update } = useSettings();
  const dark = useTheme(settings?.theme);

  const [view, setView] = useState<View>("inbox");
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const term = useDebounced(search);

  const [threads, setThreads] = useState<ApiThread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mailboxes, setMailboxes] = useState<ApiMailbox[]>([]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<ApiThread | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const [wide, setWide] = useState(false);

  // Two panes only when there is room for two. The popup never has it.
  useEffect(() => {
    if (!inTab) return;
    const check = () => setWide(window.innerWidth >= 860);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [inTab]);

  const connected = settings ? isConnected(settings) : false;

  /* ------------------------------------------------------------- the list */

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!settings || !isConnected(settings)) return;
      if (!options.silent) setLoading(true);
      setError(null);
      try {
        const result = await listThreads(settings, view, { search: term, limit: PAGE });
        setThreads(result.threads);
        setCursor(result.nextCursor);
        void cacheList(settings, view, term, result.threads);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "Could not load your mail.");
        setThreads([]);
        setCursor(null);
      } finally {
        setLoading(false);
      }
    },
    [settings, view, term],
  );

  /**
   * What this view looked like last time, on screen before the request that
   * replaces it has even been sent.
   *
   * The popup is built from scratch on every open, so without this each one
   * begins with four grey rows for as long as the round trip takes. The fetch
   * still happens, and still wins; it just no longer has an empty screen to
   * itself.
   */
  useEffect(() => {
    if (!settings || !isConnected(settings)) return;
    let alive = true;

    void cachedList(settings, view, term).then((entry) => {
      if (!alive || !entry || entry.threads.length === 0) return;
      // Only ahead of the real answer. Once that has landed it stands.
      setThreads((current) => (current.length === 0 ? entry.threads : current));
      setLoading(false);
    });

    void load();

    return () => {
      alive = false;
    };
  }, [load, settings, view, term]);

  // The mailbox picker only makes sense once we know what there is to pick.
  useEffect(() => {
    if (!settings || !isConnected(settings)) return;
    let alive = true;

    void cachedMailboxes().then((rows) => {
      if (alive && rows) setMailboxes((current) => (current.length === 0 ? rows : current));
    });

    void listMailboxes(settings)
      .then((rows) => {
        if (!alive) return;
        setMailboxes(rows);
        void cacheMailboxes(rows);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [settings]);

  async function loadMore() {
    if (!settings || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await listThreads(settings, view, {
        search: term,
        limit: PAGE,
        cursor,
      });
      setThreads((current) => [...current, ...result.threads]);
      setCursor(result.nextCursor);
    } catch {
      setCursor(null);
    } finally {
      setLoadingMore(false);
    }
  }

  /* -------------------------------------------------------- the open thread */

  const openThread = useCallback(
    async (id: string) => {
      if (!settings) return;
      setOpenId(id);
      setOpen(null);
      setOpenError(null);
      setOpenLoading(true);
      try {
        const detail = await getThread(settings, id);
        setOpen(detail);

        if (detail.unread_count > 0) {
          await patchThread(settings, id, { is_read: true });
          /**
           * The row is changed where it stands rather than the list being
           * fetched again. In the unread view a refetch would make the thing
           * just opened disappear from under the reader, which is a bad enough
           * surprise in the web app that it was fixed there too.
           */
          setThreads((current) =>
            current.map((row) => (row.id === id ? { ...row, unread_count: 0 } : row)),
          );
          setOpen((current) => (current ? { ...current, unread_count: 0 } : current));
          refreshBadge();
        }
      } catch (caught) {
        setOpenError(caught instanceof ApiError ? caught.message : "Could not open it.");
      } finally {
        setOpenLoading(false);
      }
    },
    [settings],
  );

  const closeThread = useCallback(() => {
    setOpenId(null);
    setOpen(null);
    setOpenError(null);
  }, []);

  /* ------------------------------------------------------------- the actions */

  const patch = useCallback(
    async (id: string, changes: ThreadPatch) => {
      if (!settings) return;

      // Moving a conversation out of the view takes the row with it; anything
      // else is a change to the row that stays.
      const leaves = changes.folder !== undefined && changes.folder !== VIEW_FOLDER[view];

      setThreads((current) =>
        leaves
          ? current.filter((row) => row.id !== id)
          : current.map((row) =>
              row.id === id
                ? {
                    ...row,
                    ...(changes.is_starred !== undefined ? { is_starred: changes.is_starred } : {}),
                    ...(changes.is_read !== undefined
                      ? { unread_count: changes.is_read ? 0 : Math.max(1, row.unread_count) }
                      : {}),
                  }
                : row,
            ),
      );

      if (leaves && openId === id) closeThread();
      else if (openId === id) {
        setOpen((current) =>
          current
            ? {
                ...current,
                ...(changes.is_starred !== undefined ? { is_starred: changes.is_starred } : {}),
                ...(changes.is_read !== undefined ? { unread_count: changes.is_read ? 0 : 1 } : {}),
              }
            : current,
        );
      }

      try {
        await patchThread(settings, id, changes);
        refreshBadge();
      } catch {
        // The server said no, so the list is no longer what is on screen.
        void load({ silent: true });
      }
    },
    [settings, view, openId, closeThread, load],
  );

  const trash = useCallback(
    async (id: string) => {
      if (!settings) return;
      setThreads((current) => current.filter((row) => row.id !== id));
      if (openId === id) closeThread();
      try {
        await deleteThread(settings, id, view === "trash");
        refreshBadge();
      } catch {
        void load({ silent: true });
      }
    },
    [settings, view, openId, closeThread, load],
  );

  /* ---------------------------------------------------------------- render */

  if (!settings) {
    return <div className="h-full bg-background" />;
  }

  if (!connected) {
    return <Connect />;
  }

  /*
   * The rows on their own, with no navigation attached.
   *
   * The popup wears a row of pills above them and the tab wears a rail beside
   * them, and neither layout should have to own a second copy of the list.
   */
  const rows = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {loading ? (
        <div>
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : error ? (
        <EmptyState
          title="That did not work"
          body={error}
          action={
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : watchesNothing(settings) ? (
        /* Not the same as an empty inbox, and saying "all caught up" here
             would be telling somebody their mail is read when it is hidden. */
        <EmptyState
          icon={<MailboxIcon />}
          title="No mailboxes picked"
          body="Nothing is being watched, so there is nothing to show."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => void browser.runtime.openOptionsPage()}
            >
              Pick mailboxes
            </Button>
          }
        />
      ) : threads.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={term ? "Nothing matched" : `No mail in ${VIEW_LABEL[view].toLowerCase()}`}
          body={term ? "Try a different search." : "You are all caught up."}
        />
      ) : (
        <>
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              view={view}
              selected={thread.id === openId}
              onOpen={() => void openThread(thread.id)}
              onStar={() => void patch(thread.id, { is_starred: !thread.is_starred })}
              onArchive={() => void patch(thread.id, { folder: "archive" })}
              onTrash={() => void trash(thread.id)}
            />
          ))}

          {cursor ? (
            <div className="p-3">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                busy={loadingMore}
                onClick={() => void loadMore()}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const list = (
    <div className="flex h-full min-h-0 flex-col">
      <ViewTabs view={view} onChange={setView} />
      {rows}
    </div>
  );

  const reading = (
    <ThreadView
      thread={open}
      loading={openLoading}
      error={openError}
      view={view}
      settings={settings}
      dark={dark}
      showBack={!wide}
      onBack={closeThread}
      roomy={wide}
      onPatch={(changes) => openId && void patch(openId, changes)}
      onTrash={() => openId && void trash(openId)}
    />
  );

  /*
   * The roomy layout: a rail of places, a column of conversations, and the
   * one being read. Not the popup stretched sideways — at this width the row
   * of pills is a hairline of clipped text and the header is a crowded strip
   * of icons a metre from the thing they act on.
   */
  if (wide) {
    return (
      <div className="flex h-full bg-background">
        <Rail
          view={view}
          onChange={(next) => {
            setView(next);
            closeThread();
          }}
          onOpenApp={() => openTab(`${settings.baseUrl}/mail/all/inbox`)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            view={view}
            search={search}
            onSearch={setSearch}
            loading={loading}
            onRefresh={() => {
              void load();
              refreshBadge();
            }}
            mailboxes={mailboxes}
            watchAll={settings.watchAll}
            chosen={settings.mailboxIds}
            onChoose={(choice) => void update(choice)}
          />

          <div className="flex min-h-0 flex-1">
            <div className="flex w-[380px] shrink-0 flex-col border-r border-border xl:w-[420px]">
              {rows}
            </div>
            <div className="min-w-0 flex-1 bg-card/40">{reading}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <Header
        inTab={inTab}
        searching={searching}
        search={search}
        onSearch={setSearch}
        onSearching={setSearching}
        onRefresh={() => {
          void load();
          refreshBadge();
        }}
        loading={loading}
        mailboxes={mailboxes}
        watchAll={settings.watchAll}
        chosen={settings.mailboxIds}
        onChoose={(choice) => void update(choice)}
        onOpenApp={() => openTab(`${settings.baseUrl}/mail/all/inbox`)}
      />

      <div className="min-h-0 flex-1">
        {openId ? <div className="h-full animate-fade-in">{reading}</div> : list}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ header */

interface HeaderProps {
  inTab: boolean;
  searching: boolean;
  search: string;
  loading: boolean;
  mailboxes: ApiMailbox[];
  watchAll: boolean;
  chosen: string[];
  onSearch: (value: string) => void;
  onSearching: (value: boolean) => void;
  onChoose: (choice: { watchAll: boolean; mailboxIds?: string[] }) => void;
  onRefresh: () => void;
  onOpenApp: () => void;
}

function Header({
  inTab,
  searching,
  search,
  loading,
  mailboxes,
  watchAll,
  chosen,
  onSearch,
  onSearching,
  onChoose,
  onRefresh,
  onOpenApp,
}: HeaderProps) {
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searching) box.current?.focus();
  }, [searching]);

  return (
    <header className="flex shrink-0 items-center gap-1 border-b border-border bg-rail px-2 py-1.5">
      {searching ? (
        <>
          <Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
          <input
            ref={box}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onSearch("");
                onSearching(false);
              }
            }}
            placeholder="Search mail"
            className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
          <IconButton
            label="Close search"
            onClick={() => {
              onSearch("");
              onSearching(false);
            }}
          >
            <X />
          </IconButton>
        </>
      ) : (
        <>
          <span className="ml-1 mr-1 text-[13.5px] font-semibold tracking-[-0.01em]">Mailroom</span>

          {mailboxes.length > 1 ? (
            <MailboxPicker
              mailboxes={mailboxes}
              watchAll={watchAll}
              chosen={chosen}
              onChoose={onChoose}
            />
          ) : null}

          <div className="ml-auto flex items-center gap-0.5">
            <IconButton label="Search" onClick={() => onSearching(true)}>
              <Search />
            </IconButton>
            <IconButton label="Refresh" onClick={onRefresh}>
              <RefreshCw className={cx(loading && "animate-spin")} />
            </IconButton>
            {!inTab ? (
              <IconButton
                label="Open in a tab"
                onClick={() => openTab(`${browser.runtime.getURL("/popup.html")}?tab=1`)}
              >
                <Maximize2 />
              </IconButton>
            ) : null}
            <IconButton label="Open Mailroom" onClick={onOpenApp}>
              <ExternalLink />
            </IconButton>
            <IconButton label="Settings" onClick={() => void browser.runtime.openOptionsPage()}>
              <Settings />
            </IconButton>
          </div>
        </>
      )}
    </header>
  );
}

/* -------------------------------------------------------------- the tab rail */

const VIEW_ICON: Record<View, React.ReactNode> = {
  inbox: <Inbox />,
  unread: <MailOpen />,
  starred: <Star />,
  sent: <Send />,
  archive: <Archive />,
  spam: <ShieldAlert />,
  trash: <Trash2 />,
};

/**
 * Where you can go, down the left.
 *
 * The same seven places the popup shows as pills, given room to be a list
 * with names and icons. A rail is also where a full-window mail client puts
 * them, so it needs no learning.
 */
function Rail({
  view,
  onChange,
  onOpenApp,
}: {
  view: View;
  onChange: (value: View) => void;
  onOpenApp: () => void;
}) {
  return (
    <nav className="flex w-[216px] shrink-0 flex-col border-r border-border bg-rail">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <span className="text-[14px] font-semibold tracking-[-0.01em]">Mailroom</span>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {VIEWS.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => onChange(entry)}
            className={cx(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition [&_svg]:size-4 [&_svg]:shrink-0",
              entry === view
                ? "bg-primary-soft text-primary-soft-foreground"
                : "text-rail-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {VIEW_ICON[entry]}
            {VIEW_LABEL[entry]}
          </button>
        ))}
      </div>

      <div className="shrink-0 space-y-0.5 border-t border-border px-2 py-2">
        <RailAction icon={<ExternalLink />} label="Open Mailroom" onClick={onOpenApp} />
        <RailAction
          icon={<Settings />}
          label="Settings"
          onClick={() => void browser.runtime.openOptionsPage()}
        />
      </div>
    </nav>
  );
}

function RailAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[12.5px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0"
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * The bar above both columns: where you are, and how to search it.
 *
 * Search is a real box here rather than the popup's icon that swaps the
 * header out. There is width for it, and a hidden search in a window this
 * size is a search nobody finds.
 */
function TopBar({
  view,
  search,
  onSearch,
  loading,
  onRefresh,
  mailboxes,
  watchAll,
  chosen,
  onChoose,
}: {
  view: View;
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  onRefresh: () => void;
  mailboxes: ApiMailbox[];
  watchAll: boolean;
  chosen: string[];
  onChoose: (choice: { watchAll: boolean; mailboxIds?: string[] }) => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
      <h1 className="text-[14px] font-semibold tracking-[-0.01em]">{VIEW_LABEL[view]}</h1>

      {mailboxes.length > 1 ? (
        <MailboxPicker
          mailboxes={mailboxes}
          watchAll={watchAll}
          chosen={chosen}
          onChoose={onChoose}
        />
      ) : null}

      <label className="ml-auto flex h-8 w-full max-w-[380px] items-center gap-2 rounded-lg border border-border bg-card px-2.5 focus-within:border-ring">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && onSearch("")}
          placeholder="Search mail"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
        {search ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onSearch("")}
            className="shrink-0 text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </label>

      <IconButton label="Refresh" onClick={onRefresh}>
        <RefreshCw className={cx(loading && "animate-spin")} />
      </IconButton>
    </header>
  );
}

/* ------------------------------------------------------------------- views */

function ViewTabs({ view, onChange }: { view: View; onChange: (value: View) => void }) {
  return (
    <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {VIEWS.map((entry) => (
        <button
          key={entry}
          type="button"
          onClick={() => onChange(entry)}
          className={cx(
            "shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium transition",
            entry === view
              ? "bg-primary-soft text-primary-soft-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {VIEW_LABEL[entry]}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- not connected yet */

function Connect() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-8 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <Plug className="size-5" />
      </div>
      <div className="text-[15px] font-semibold">Connect to Mailroom</div>
      <p className="text-[12.5px] text-muted-foreground">
        Point this at your own instance with its address and an API key, and your inbox turns up
        here.
      </p>
      <Button size="md" pill onClick={() => void browser.runtime.openOptionsPage()}>
        Set it up
      </Button>
    </div>
  );
}
