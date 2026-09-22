"use client";

import { Avatar, Button, Checkbox, ConfirmDialog, Hint, IconButton } from "@/components/kit";
import type { Label as LabelRow } from "@/db/schema";
import type { ViewFolder } from "@/lib/scope";
import { cn } from "@/lib/utils";
import {
  deleteThreadsAction,
  moveThreadsAction,
  restoreThreadsAction,
  setReadAction,
  setStarAction,
} from "@/server/actions";
import type { ThreadListItem } from "@/server/threads";
import { isThisYear, isToday } from "date-fns";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArchiveRestore,
  FileText,
  Inbox,
  Loader2,
  MailOpen,
  MailQuestion,
  Paperclip,
  RefreshCw,
  Send,
  ShieldAlert,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { LabelMenu } from "./label-menu";

/** What each folder says when it has nothing in it. */
const EMPTY: Record<ViewFolder, { icon: LucideIcon; title: string; body: string }> = {
  inbox: {
    icon: Inbox,
    title: "Nothing here",
    body: "New mail appears the moment the Cloudflare worker delivers it.",
  },
  starred: {
    icon: Star,
    title: "Nothing starred",
    body: "Star a conversation and it collects here.",
  },
  sent: {
    icon: Send,
    title: "Nothing sent yet",
    body: "Messages you send through SES appear here.",
  },
  drafts: {
    icon: FileText,
    title: "No drafts",
    body: "Press c to start writing. Drafts save themselves as you type.",
  },
  archive: {
    icon: Archive,
    title: "Nothing archived",
    body: "Archived conversations are kept out of the inbox, not deleted.",
  },
  spam: {
    icon: ShieldAlert,
    title: "No spam",
    body: "Conversations you report land here.",
  },
  trash: {
    icon: Trash2,
    title: "Trash is empty",
    body: "Deleted conversations rest here before they go for good.",
  },
};

interface Props {
  items: ThreadListItem[];
  folder: ViewFolder;
  activeThreadId?: string;
  /** Base list URL, e.g. /mail/d/acme.com/inbox */
  baseHref: string;
  /** Query string already on the list URL (search, label, unread), no leading "?". */
  listQuery: string;
  nextCursor: string | null;
  prevCursor: string | null;
  /** Every thread the view matches, and how many come before this page. */
  total: number;
  offset: number;
  showMailbox: boolean;
  labels: LabelRow[];
  /** Compact drops the preview line and tightens the rows. */
  density?: "comfortable" | "compact";
  /**
   * True for a view a conversation can drop out of merely by being read, which
   * is the Unread filter. Rows that leave it are held where they are.
   */
  holdRead?: boolean;
  /**
   * True when the list has the whole screen rather than a column beside the
   * conversation. With that much width a row fits on one line, which is what
   * every full-width mail list does.
   */
  wide?: boolean;
}

export function ThreadList({
  items,
  folder,
  activeThreadId,
  baseHref,
  listQuery,
  nextCursor,
  prevCursor,
  total,
  offset,
  showMailbox,
  labels,
  density = "comfortable",
  wide = false,
  holdRead = false,
}: Props) {
  const compact = density === "compact";
  const router = useRouter();
  const [purging, setPurging] = useState<ThreadListItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  /**
   * Opening a conversation in the Unread filter marks it read, which takes it
   * out of the list under the pointer — and takes everything below it up a
   * row, so the next thing clicked is not the thing that was aimed at. The
   * rows that have been read stay where they are, greyed, until the view is
   * loaded again.
   */
  const held = useRef<{ view: string; rows: ThreadListItem[] }>({ view: "", rows: [] });
  const view = `${baseHref}?${listQuery}`;

  const shown = useMemo(() => {
    if (!holdRead) return items;
    if (held.current.view !== view) held.current = { view, rows: [] };

    const live = new Set(items.map((item) => item.id));
    const carried = held.current.rows
      .filter((row) => !live.has(row.id))
      // It is only still here because it was read, so it says so.
      .map((row) => ({ ...row, unreadCount: 0 }));

    const merged = [...items, ...carried].sort(
      (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
    );
    held.current.rows = merged;
    return merged;
  }, [items, holdRead, view]);

  const hrefFor = (threadId: string) =>
    `${baseHref}?${listQuery ? `${listQuery}&` : ""}t=${threadId}`;

  const pageHref = (cursor: string, direction: "older" | "newer") => {
    const params = new URLSearchParams(listQuery);
    params.set("cursor", cursor);
    if (direction === "newer") params.set("dir", "newer");
    return `${baseHref}?${params.toString()}`;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear the selection when the view changes
  useEffect(() => setSelected(new Set()), [folder, items.length]);

  /**
   * `touched` names the conversations an action moves or destroys. They are
   * let go of, so a held row does not outlive the thing it stands for.
   */
  function run(action: () => Promise<unknown>, touched?: string[]) {
    if (touched?.length) {
      const gone = new Set(touched);
      held.current.rows = held.current.rows.filter((row) => !gone.has(row.id));
    }
    startTransition(async () => {
      await action();
      setSelected(new Set());
      router.refresh();
    });
  }

  const ids = [...selected];
  const hasSelection = selected.size > 0;
  const allSelected = shown.length > 0 && selected.size === shown.length;

  /** One conversation. Pulled out so the sections can each map it. */
  function row(item: ThreadListItem) {
    // Nothing in Sent is unread — you wrote it. What is unread in one of these
    // threads is a reply, and the reply is waiting in the inbox.
    const unread = folder !== "sent" && item.unreadCount > 0;
    const active = item.id === activeThreadId;
    const sender = item.participants[0];
    const checked = selected.has(item.id);

    return (
      <li
        key={item.id}
        className={cn(
          "group relative flex border-b border-border/70 px-4 transition-colors duration-100",
          wide ? "items-start lg:items-center" : "items-start",
          compact ? "gap-2.5 py-1.5" : wide ? "gap-3 py-3 lg:gap-2.5 lg:py-1.5" : "gap-3 py-3",
          active ? "bg-accent" : "hover:bg-accent/55",
        )}
      >
        {/* The avatar becomes a checkbox the moment you reach for it. */}
        <span className={cn("relative mt-0.5 shrink-0", compact ? "size-6" : "size-8")}>
          <Avatar
            size={compact ? "sm" : "md"}
            name={sender?.name}
            address={sender?.address ?? item.id}
            className={cn(
              "pointer-events-none absolute inset-0 transition-opacity duration-100",
              checked ? "opacity-0" : "group-hover:opacity-0",
            )}
          />
          <span
            className={cn(
              "absolute inset-0 grid place-items-center transition-opacity duration-100",
              checked ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <Checkbox
              checked={checked}
              onCheckedChange={() =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })
              }
              aria-label={`Select ${item.subject || "conversation"}`}
            />
          </span>
        </span>

        {/* One line across a full-width list, three in a column beside the
            conversation. Same row, read at the width it has. */}
        {wide && (
          <Link
            href={hrefFor(item.id)}
            className="hidden min-w-0 flex-1 items-center gap-3 lg:flex"
          >
            <span
              className={cn(
                "w-44 shrink-0 truncate text-[13px] xl:w-56",
                unread ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
              )}
            >
              {sender?.name || sender?.address || "Unknown"}
            </span>
            {item.messageCount > 1 && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
                {item.messageCount}
              </span>
            )}

            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className={cn(
                  "shrink-0 truncate text-[13.5px]",
                  unread ? "font-semibold text-foreground" : "font-medium text-foreground/85",
                )}
              >
                {item.subject || "(no subject)"}
              </span>
              {item.labels.map((entry) => (
                <span
                  key={entry.id}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground"
                >
                  <span
                    className="size-[6px] rounded-full"
                    style={{ background: entry.color }}
                    aria-hidden
                  />
                  {entry.name}
                </span>
              ))}
              {item.snippet && !compact && (
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                  — {item.snippet}
                </span>
              )}
            </span>

            {showMailbox && (
              <span
                className="shrink-0 rounded-full px-1.5 py-px font-mono text-[10px]"
                style={{
                  background: `color-mix(in oklab, ${item.mailboxColor} 15%, transparent)`,
                  color: item.mailboxColor,
                }}
              >
                {item.mailboxAddress}
              </span>
            )}
            {item.hasAttachments && (
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            {unread && (
              <span className="size-[7px] shrink-0 rounded-full bg-primary" aria-label="Unread" />
            )}
            {item.isStarred && (
              <Star className="size-3.5 shrink-0 fill-warn text-warn group-hover:invisible" />
            )}
            {/* The row actions take the timestamp's place on hover. */}
            <span className="w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums group-hover:invisible">
              {formatStamp(item.lastMessageAt)}
            </span>
          </Link>
        )}

        <Link href={hrefFor(item.id)} className={cn("min-w-0 flex-1", wide && "lg:hidden")}>
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[12.5px]",
                unread ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
              )}
            >
              {sender?.name || sender?.address || "Unknown"}
            </span>

            {showMailbox && (
              <span
                className="shrink-0 rounded-full px-1.5 py-px font-mono text-[10px]"
                style={{
                  background: `color-mix(in oklab, ${item.mailboxColor} 15%, transparent)`,
                  color: item.mailboxColor,
                }}
              >
                {item.mailboxAddress}
              </span>
            )}
            {item.messageCount > 1 && (
              <span className="shrink-0 rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
                {item.messageCount}
              </span>
            )}
            {item.hasAttachments && (
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            {/* A star used to sit over the timestamp, which is how a starred
                conversation came to be dated "21 Sep★". It stands in the line
                now, like everything else on it. */}
            {item.isStarred && (
              <Star className="size-3.5 shrink-0 fill-warn text-warn group-hover:invisible" />
            )}
            {/* The row actions take the timestamp's place on hover. */}
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums group-hover:invisible">
              {formatStamp(item.lastMessageAt)}
            </span>
          </span>

          <span className="mt-0.5 flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13.5px]",
                unread ? "font-semibold text-foreground" : "font-medium text-foreground/85",
              )}
            >
              {item.subject || "(no subject)"}
            </span>
            {unread && (
              <span className="size-[7px] shrink-0 rounded-full bg-primary" aria-label="Unread" />
            )}
          </span>

          {item.snippet && !compact && (
            <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
              {item.snippet}
            </span>
          )}

          {/* What it is filed under, said on the row rather than only inside
              the conversation, so a folder can be read without opening it. */}
          {item.labels.length > 0 && (
            <span className="mt-1.5 flex flex-wrap items-center gap-1">
              {item.labels.map((entry) => (
                <span
                  key={entry.id}
                  className="flex items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground"
                >
                  <span
                    className="size-[6px] rounded-full"
                    style={{ background: entry.color }}
                    aria-hidden
                  />
                  {entry.name}
                </span>
              ))}
            </span>
          )}
        </Link>

        <span
          className={cn(
            "absolute right-3 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
            wide ? "top-2 lg:top-1/2 lg:-translate-y-1/2" : "top-2",
          )}
        >
          <RowAction
            label={item.isStarred ? "Unstar" : "Star"}
            onClick={() => run(() => setStarAction([item.id], !item.isStarred))}
          >
            <Star className={cn(item.isStarred && "fill-warn text-warn")} />
          </RowAction>
          {folder === "trash" ? (
            <RowAction
              label="Put back"
              onClick={() => run(() => restoreThreadsAction([item.id]), [item.id])}
            >
              <ArchiveRestore />
            </RowAction>
          ) : (
            <RowAction
              label="Archive"
              onClick={() => run(() => moveThreadsAction([item.id], "archive"), [item.id])}
            >
              <Archive />
            </RowAction>
          )}
          <RowAction
            label={item.unreadCount > 0 ? "Mark read" : "Mark unread"}
            onClick={() => run(() => setReadAction([item.id], item.unreadCount > 0))}
          >
            {item.unreadCount > 0 ? <MailOpen /> : <MailQuestion />}
          </RowAction>
          {/* Everywhere else this moves the conversation to Trash and is
            undoable from there. In Trash there is nowhere further to
            move it, so the same click destroys it and has to ask. */}
          <RowAction
            label={folder === "trash" ? "Delete forever" : "Delete"}
            destructive
            onClick={() => {
              if (folder === "trash") setPurging(item);
              else run(() => deleteThreadsAction([item.id]), [item.id]);
            }}
          >
            <Trash2 />
          </RowAction>
        </span>
      </li>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Everywhere but Trash, deleting moves a conversation somewhere it can
          be got back from. Here there is nowhere further to move it. */}
      <ConfirmDialog
        open={purging !== null}
        onOpenChange={(next) => !next && setPurging(null)}
        title="Delete this conversation forever?"
        description={purging?.subject || "(no subject)"}
        consequences="It is already in Trash. This removes its messages and their attachments for good."
        confirmLabel="Delete forever"
        onConfirm={async () => {
          if (!purging) return;
          await deleteThreadsAction([purging.id]);
          setPurging(null);
          router.refresh();
        }}
      />

      {/* The toolbar stays put whether or not anything is picked out. It used
          to appear on the first tick and push the list down, which moved the
          row you were reaching for out from under the pointer. */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-4">
        <Checkbox
          checked={allSelected}
          onCheckedChange={() =>
            setSelected(allSelected ? new Set() : new Set(shown.map((item) => item.id)))
          }
          aria-label="Select all"
          className="mr-2 shrink-0"
        />
        <span className="mr-1 w-3 shrink-0 text-[12px] font-medium text-muted-foreground tabular-nums">
          {hasSelection ? selected.size : ""}
        </span>
        <BulkAction
          label="Mark read"
          disabled={!hasSelection}
          onClick={() => run(() => setReadAction(ids, true))}
        >
          <MailOpen />
        </BulkAction>
        <BulkAction
          label="Mark unread"
          disabled={!hasSelection}
          onClick={() => run(() => setReadAction(ids, false))}
        >
          <MailQuestion />
        </BulkAction>
        {folder === "archive" || folder === "spam" || folder === "trash" ? (
          <BulkAction
            label="Move to inbox"
            disabled={!hasSelection}
            onClick={() => run(() => moveThreadsAction(ids, "inbox"), ids)}
          >
            <ArchiveRestore />
          </BulkAction>
        ) : (
          <BulkAction
            label="Archive"
            disabled={!hasSelection}
            onClick={() => run(() => moveThreadsAction(ids, "archive"), ids)}
          >
            <Archive />
          </BulkAction>
        )}
        <BulkAction
          label="Report spam"
          disabled={!hasSelection}
          onClick={() => run(() => moveThreadsAction(ids, "spam"), ids)}
        >
          <ShieldAlert />
        </BulkAction>
        <LabelMenu threadIds={ids} labels={labels} onDone={() => setSelected(new Set())} />
        <BulkAction
          label="Delete"
          destructive
          disabled={!hasSelection}
          onClick={() => run(() => deleteThreadsAction(ids), ids)}
        >
          <Trash2 />
        </BulkAction>
        <span className="ml-auto">
          <BulkAction label="Refresh" onClick={() => run(async () => {})}>
            {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </BulkAction>
        </span>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto pb-3">
        {shown.length === 0 && <EmptyFolder folder={folder} />}

        {shown.map(row)}

        {/* Paging used to go one way, so a reader who pressed it twice had no
            route back but the browser's own. The range says where they are:
            a cursor is a position in an ordering, and nothing about it is
            visible from the rows themselves. */}
        {shown.length > 0 && (
          <li className="flex items-center gap-3 px-4 pt-3">
            <span className="text-[11.5px] text-muted-foreground tabular-nums">
              {offset + 1}–{offset + items.length} of {total}
            </span>

            {(prevCursor || nextCursor) && (
              <span className="ml-auto flex items-center gap-2">
                {prevCursor && (
                  <Button variant="subtle" size="sm" pill asChild>
                    <Link href={pageHref(prevCursor, "newer")}>Newer</Link>
                  </Button>
                )}
                {nextCursor && (
                  <Button variant="subtle" size="sm" pill asChild>
                    <Link href={pageHref(nextCursor, "older")}>Older</Link>
                  </Button>
                )}
              </span>
            )}
          </li>
        )}
      </ul>
    </div>
  );
}

function EmptyFolder({ folder }: { folder: ViewFolder }) {
  const { icon: Icon, title, body } = EMPTY[folder];
  return (
    <li className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <span className="max-w-60 space-y-1">
        <span className="block font-display text-[15px] font-semibold">{title}</span>
        <span className="block text-[13px] leading-relaxed text-muted-foreground">{body}</span>
      </span>
    </li>
  );
}

function RowAction({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  /** Archive and delete are near-identical at this size; colour tells them apart. */
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label}>
      <IconButton
        label={label}
        size="xs"
        variant="subtle"
        className={cn(
          "bg-card shadow-raise hover:bg-accent",
          destructive && "hover:bg-danger-soft hover:text-destructive",
        )}
        onClick={onClick}
      >
        {children}
      </IconButton>
    </Hint>
  );
}

function BulkAction({
  label,
  onClick,
  destructive,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  /** Nothing is picked out, so the button is there but has nothing to act on. */
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label}>
      <IconButton
        label={label}
        variant={destructive ? "danger" : "ghost"}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </IconButton>
    </Hint>
  );
}

function formatStamp(value: Date) {
  const date = new Date(value);
  if (isToday(date))
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (isThisYear(date)) return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return date.toLocaleDateString("en-GB", { year: "2-digit", month: "short" });
}
