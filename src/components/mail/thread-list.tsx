"use client";

import { Avatar, Button, Checkbox, ConfirmDialog, Hint, IconButton } from "@/components/kit";
import type { Label as LabelRow } from "@/db/schema";
import type { ViewFolder } from "@/lib/scope";
import { cn } from "@/lib/utils";
import {
  deleteThreadsAction,
  moveThreadsAction,
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
import { useEffect, useState, useTransition } from "react";
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
  showMailbox: boolean;
  labels: LabelRow[];
}

export function ThreadList({
  items,
  folder,
  activeThreadId,
  baseHref,
  listQuery,
  nextCursor,
  showMailbox,
  labels,
}: Props) {
  const router = useRouter();
  const [purging, setPurging] = useState<ThreadListItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const hrefFor = (threadId: string) =>
    `${baseHref}?${listQuery ? `${listQuery}&` : ""}t=${threadId}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear the selection when the view changes
  useEffect(() => setSelected(new Set()), [folder, items.length]);

  function run(action: () => Promise<unknown>) {
    startTransition(async () => {
      await action();
      setSelected(new Set());
      router.refresh();
    });
  }

  const ids = [...selected];
  const hasSelection = selected.size > 0;
  const allSelected = items.length > 0 && selected.size === items.length;

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

      {/* The toolbar only appears once there is a selection to act on. */}
      {hasSelection && (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-4">
          <Checkbox
            checked={allSelected}
            onCheckedChange={() =>
              setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))
            }
            aria-label="Select all"
            className="mr-2 shrink-0"
          />
          <span className="mr-1 shrink-0 text-[12px] font-medium text-muted-foreground tabular-nums">
            {selected.size}
          </span>
          <BulkAction label="Mark read" onClick={() => run(() => setReadAction(ids, true))}>
            <MailOpen />
          </BulkAction>
          <BulkAction label="Mark unread" onClick={() => run(() => setReadAction(ids, false))}>
            <MailQuestion />
          </BulkAction>
          {folder === "archive" || folder === "spam" || folder === "trash" ? (
            <BulkAction
              label="Move to inbox"
              onClick={() => run(() => moveThreadsAction(ids, "inbox"))}
            >
              <ArchiveRestore />
            </BulkAction>
          ) : (
            <BulkAction
              label="Archive"
              onClick={() => run(() => moveThreadsAction(ids, "archive"))}
            >
              <Archive />
            </BulkAction>
          )}
          <BulkAction label="Report spam" onClick={() => run(() => moveThreadsAction(ids, "spam"))}>
            <ShieldAlert />
          </BulkAction>
          <LabelMenu threadIds={ids} labels={labels} onDone={() => setSelected(new Set())} />
          <BulkAction
            label="Delete"
            destructive
            onClick={() => run(() => deleteThreadsAction(ids))}
          >
            <Trash2 />
          </BulkAction>
          <span className="ml-auto">
            <BulkAction label="Refresh" onClick={() => run(async () => {})}>
              {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </BulkAction>
          </span>
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto pb-3">
        {items.length === 0 && <EmptyFolder folder={folder} />}

        {items.map((item) => {
          const unread = item.unreadCount > 0;
          const active = item.id === activeThreadId;
          const sender = item.participants[0];
          const checked = selected.has(item.id);

          return (
            <li
              key={item.id}
              className={cn(
                "group relative flex items-start gap-3 border-b border-border/70 px-4 py-3 transition-colors duration-100",
                active ? "bg-accent" : "hover:bg-accent/55",
              )}
            >
              {/* The avatar becomes a checkbox the moment you reach for it. */}
              <span className="relative mt-0.5 size-8 shrink-0">
                <Avatar
                  size="md"
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

              {/* Three lines: who it is, what it is about, how it starts. */}
              <Link href={hrefFor(item.id)} className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[12.5px]",
                      unread
                        ? "font-semibold text-foreground"
                        : "font-medium text-muted-foreground",
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
                    <span
                      className="size-[7px] shrink-0 rounded-full bg-primary"
                      aria-label="Unread"
                    />
                  )}
                </span>

                {item.snippet && (
                  <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
                    {item.snippet}
                  </span>
                )}
              </Link>

              <span className="absolute top-2 right-3 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <RowAction
                  label={item.isStarred ? "Unstar" : "Star"}
                  onClick={() => run(() => setStarAction([item.id], !item.isStarred))}
                >
                  <Star className={cn(item.isStarred && "fill-warn text-warn")} />
                </RowAction>
                <RowAction
                  label="Archive"
                  onClick={() => run(() => moveThreadsAction([item.id], "archive"))}
                >
                  <Archive />
                </RowAction>
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
                    else run(() => deleteThreadsAction([item.id]));
                  }}
                >
                  <Trash2 />
                </RowAction>
              </span>

              {/* Starred rows keep their star visible when the row is at rest. */}
              {item.isStarred && (
                <Star className="absolute top-3 right-3 size-4 fill-warn text-warn group-hover:hidden" />
              )}
            </li>
          );
        })}

        {nextCursor && (
          <li className="px-4 pt-3">
            <Button variant="subtle" size="sm" block pill asChild>
              <Link
                href={`${baseHref}?${listQuery ? `${listQuery}&` : ""}cursor=${encodeURIComponent(nextCursor)}`}
              >
                Load older
              </Link>
            </Button>
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
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label}>
      <IconButton label={label} variant={destructive ? "danger" : "ghost"} onClick={onClick}>
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
