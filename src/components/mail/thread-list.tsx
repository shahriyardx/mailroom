"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ViewFolder } from "@/lib/scope";
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
  Paperclip,
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
}

export function ThreadList({
  items,
  folder,
  activeThreadId,
  baseHref,
  listQuery,
  nextCursor,
  showMailbox,
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {selected.size > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b bg-accent/60 px-2">
          <span className="mr-1 font-mono text-[10px] text-muted-foreground">
            {selected.size} selected
          </span>
          <BulkAction label="Archive" onClick={() => run(() => moveThreadsAction(ids, "archive"))}>
            <Archive className="size-3.5" />
          </BulkAction>
          {folder !== "inbox" && (
            <BulkAction
              label="Move to inbox"
              onClick={() => run(() => moveThreadsAction(ids, "inbox"))}
            >
              <ArchiveRestore className="size-3.5" />
            </BulkAction>
          )}
          <BulkAction label="Mark read" onClick={() => run(() => setReadAction(ids, true))}>
            <MailOpen className="size-3.5" />
          </BulkAction>
          <BulkAction label="Report spam" onClick={() => run(() => moveThreadsAction(ids, "spam"))}>
            <ShieldAlert className="size-3.5" />
          </BulkAction>
          <BulkAction label="Delete" onClick={() => run(() => deleteThreadsAction(ids))}>
            <Trash2 className="size-3.5" />
          </BulkAction>
          {pending && <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" />}
        </div>
      )}

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
                "group relative border-b transition-colors duration-100",
                unread && "unread-bar",
                active ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              <Link href={hrefFor(item.id)} className="block py-2 pr-3 pl-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-[3px] font-mono text-[9px] font-semibold text-white transition-opacity",
                      checked ? "opacity-0" : "group-hover:opacity-0",
                    )}
                    style={{ background: colorOf(sender?.address ?? item.id) }}
                    aria-hidden
                  >
                    {initialsOf(sender?.name || sender?.address || "?")}
                  </span>

                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[12.5px]",
                      unread ? "font-semibold" : "text-foreground/80",
                    )}
                  >
                    {sender?.name || sender?.address || "Unknown"}
                  </span>

                  {item.messageCount > 1 && (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {item.messageCount}
                    </span>
                  )}
                  {item.hasAttachments && (
                    <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {formatStamp(item.lastMessageAt)}
                  </span>
                </div>

                <p
                  className={cn(
                    "mt-1 truncate pl-7 text-[12.5px]",
                    unread ? "font-medium text-foreground" : "text-foreground/70",
                  )}
                >
                  {item.subject || "(no subject)"}
                </p>

                <p className="mt-0.5 truncate pl-7 text-[11.5px] text-muted-foreground">
                  {item.snippet}
                </p>

                {showMailbox && (
                  <p className="mt-1 pl-7">
                    <span
                      className="rounded-[2px] px-1 py-px font-mono text-[9.5px]"
                      style={{
                        background: `color-mix(in oklab, ${item.mailboxColor} 14%, transparent)`,
                        color: item.mailboxColor,
                      }}
                    >
                      {item.mailboxAddress}
                    </span>
                  </p>
                )}
              </Link>

              {/* The checkbox takes over the avatar slot on hover, so nothing overlaps. */}
              <div
                className={cn(
                  "absolute top-2 left-3 grid size-5 place-items-center transition-opacity",
                  checked
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
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
                  className="size-4 rounded-[3px]"
                />
              </div>

              <button
                type="button"
                onClick={() => run(() => setStarAction([item.id], !item.isStarred))}
                aria-label={item.isStarred ? "Unstar" : "Star"}
                className={cn(
                  "absolute right-2.5 bottom-2 rounded-sm p-0.5 transition-opacity",
                  item.isStarred
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 focus:opacity-100",
                )}
              >
                <Star
                  className={cn(
                    "size-3.5",
                    item.isStarred
                      ? "fill-warn text-warn"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                />
              </button>
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
          <Button variant="ghost" size="icon" className="size-7 rounded-sm" onClick={onClick}>
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
