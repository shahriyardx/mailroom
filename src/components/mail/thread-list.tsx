"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FOLDER_LABELS, type ViewFolder } from "@/lib/scope";
import { cn, colorOf, initialsOf } from "@/lib/utils";
import {
  deleteThreadsAction,
  moveThreadsAction,
  setReadAction,
  setStarAction,
} from "@/server/actions";
import type { ThreadListItem } from "@/server/threads";
import { isThisYear, isToday } from "date-fns";
import {
  Archive,
  ArchiveRestore,
  Loader2,
  MailOpen,
  MailQuestion,
  Paperclip,
  RefreshCw,
  ShieldAlert,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

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
  /** Which mailboxes this view covers, shown beside the folder name. */
  scopeLabel: string;
}

export function ThreadList({
  items,
  folder,
  activeThreadId,
  baseHref,
  listQuery,
  nextCursor,
  showMailbox,
  scopeLabel,
}: Props) {
  const router = useRouter();
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
      {/* One bar. It names the view until something is selected, then it
          becomes the actions for that selection. */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Checkbox
          checked={allSelected}
          onCheckedChange={() =>
            setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))
          }
          aria-label="Select all"
          className="size-4 shrink-0 rounded-md"
        />

        {hasSelection ? (
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <BulkAction label="Mark read" onClick={() => run(() => setReadAction(ids, true))}>
              <MailOpen className="size-4" />
            </BulkAction>
            <BulkAction label="Mark unread" onClick={() => run(() => setReadAction(ids, false))}>
              <MailQuestion className="size-4" />
            </BulkAction>
            <BulkAction
              label="Archive"
              onClick={() => run(() => moveThreadsAction(ids, "archive"))}
            >
              <Archive className="size-4" />
            </BulkAction>
            {folder !== "inbox" && (
              <BulkAction
                label="Move to inbox"
                onClick={() => run(() => moveThreadsAction(ids, "inbox"))}
              >
                <ArchiveRestore className="size-4" />
              </BulkAction>
            )}
            <BulkAction
              label="Report spam"
              onClick={() => run(() => moveThreadsAction(ids, "spam"))}
            >
              <ShieldAlert className="size-4" />
            </BulkAction>
            <BulkAction label="Delete" onClick={() => run(() => deleteThreadsAction(ids))}>
              <Trash2 className="size-4" />
            </BulkAction>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="shrink-0 font-medium text-[13px]">{FOLDER_LABELS[folder]}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {scopeLabel}
            </span>
          </div>
        )}

        <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {hasSelection ? `${selected.size} selected` : items.length}
        </span>

        <BulkAction label="Refresh" onClick={() => run(async () => {})}>
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </BulkAction>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 && (
          <li className="px-6 py-16 text-center">
            <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
              no messages
            </p>
            <p className="mx-auto mt-2 max-w-52 text-[12px] text-muted-foreground/70">
              New mail appears here the moment the Cloudflare worker delivers it.
            </p>
          </li>
        )}

        {items.map((item) => {
          const unread = item.unreadCount > 0;
          const active = item.id === activeThreadId;
          const sender = item.participants[0];
          const checked = selected.has(item.id);

          return (
            <li
              key={item.id}
              className={cn(
                "group relative flex items-start gap-2 border-b px-3 py-2 transition-colors duration-100",
                unread && "unread-bar",
                active ? "bg-accent" : "hover:bg-accent/45",
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
                className="mt-1 size-4 shrink-0 rounded-md"
              />

              <button
                type="button"
                onClick={() => run(() => setStarAction([item.id], !item.isStarred))}
                aria-label={item.isStarred ? "Unstar" : "Star"}
                className="mt-0.5 shrink-0 rounded-md p-0.5"
              >
                <Star
                  className={cn(
                    "size-3.5 transition-colors",
                    item.isStarred
                      ? "fill-warn text-warn"
                      : "text-muted-foreground/50 hover:text-foreground",
                  )}
                />
              </button>

              <span
                className="mt-px grid size-6 shrink-0 place-items-center rounded-lg font-mono text-[10px] font-semibold text-white"
                style={{ background: colorOf(sender?.address ?? item.id) }}
                aria-hidden
              >
                {initialsOf(sender?.name || sender?.address || "?")}
              </span>

              {/* Two lines only: who it is, then what it says. */}
              <Link href={hrefFor(item.id)} className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[13px]",
                      unread ? "font-semibold text-foreground" : "font-medium text-foreground/75",
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
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {item.messageCount}
                    </span>
                  )}
                  {item.hasAttachments && (
                    <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {formatStamp(item.lastMessageAt)}
                  </span>
                </span>

                <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[12.5px]">
                  <span
                    className={cn(
                      "shrink-0 truncate",
                      unread ? "font-medium text-foreground" : "text-foreground/70",
                    )}
                    style={{ maxWidth: "60%" }}
                  >
                    {item.subject || "(no subject)"}
                  </span>
                  {item.snippet && (
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      &ndash; {item.snippet}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}

        {nextCursor && (
          <li className="p-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full font-mono text-[11px]"
              nativeButton={false}
              render={
                <Link
                  href={`${baseHref}?${listQuery ? `${listQuery}&` : ""}cursor=${encodeURIComponent(nextCursor)}`}
                />
              }
            >
              Load older
            </Button>
          </li>
        )}
      </ul>
    </div>
  );
}

function BulkAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" className="size-7 rounded-lg" onClick={onClick}>
            {children}
          </Button>
        }
      />
      <TooltipContent side="bottom" className="font-mono text-[11px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function formatStamp(value: Date) {
  const date = new Date(value);
  if (isToday(date))
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (isThisYear(date)) return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return date.toLocaleDateString("en-GB", { year: "2-digit", month: "short" });
}
