import { cx, displayName, rowPerson, shortTime, threadSubject } from "@/lib/format";
import type { ApiThread, View } from "@/lib/types";
import { Archive, Paperclip, Star, Trash2 } from "lucide-react";
import { Avatar, IconButton } from "./kit";

/**
 * One conversation in the list.
 *
 * Three lines, same as the web app: who and when, the subject with its unread
 * dot, then the snippet. The actions live where the timestamp is and appear
 * on hover, so a resting list is only mail.
 */

interface Props {
  thread: ApiThread;
  view: View;
  selected: boolean;
  onOpen: () => void;
  onStar: () => void;
  onArchive: () => void;
  onTrash: () => void;
}

export function ThreadRow({ thread, view, selected, onOpen, onStar, onArchive, onTrash }: Props) {
  const person = rowPerson(thread, view);
  const unread = thread.unread_count > 0;

  return (
    <div
      className={cx(
        "group relative flex cursor-pointer gap-3 border-b border-border/60 px-3 py-2.5 transition",
        selected ? "bg-primary-soft/60" : "hover:bg-accent/60",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-0 cursor-pointer"
        aria-label={`Open: ${threadSubject(thread)}`}
      />

      <Avatar name={person.name} address={person.address} className="relative z-10" />

      <div className="relative z-10 min-w-0 flex-1 pointer-events-none">
        <div className="flex items-baseline gap-2">
          <span
            className={cx(
              "min-w-0 flex-1 truncate text-[13px]",
              unread ? "font-semibold text-foreground" : "text-foreground/90",
            )}
          >
            {displayName(person)}
            {thread.message_count > 1 ? (
              <span className="ml-1.5 text-[11.5px] font-normal text-muted-foreground">
                {thread.message_count}
              </span>
            ) : null}
          </span>

          <span className="flex shrink-0 items-center gap-1">
            {thread.has_attachments ? <Paperclip className="size-3 text-muted-foreground" /> : null}
            {thread.is_starred ? <Star className="size-3 fill-warn text-warn" /> : null}
            <span className="text-[11.5px] tabular-nums text-muted-foreground group-hover:invisible">
              {shortTime(thread.last_message_at)}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {unread ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
          <span
            className={cx(
              "min-w-0 truncate text-[12.5px]",
              unread ? "font-medium text-foreground" : "text-foreground/80",
            )}
          >
            {threadSubject(thread)}
          </span>
        </div>

        <div className="truncate text-[12px] text-muted-foreground">
          {thread.snippet || "No preview"}
        </div>

        {thread.labels && thread.labels.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {thread.labels.map((label) => (
              <span
                key={label.id}
                className="rounded-full px-1.5 py-px text-[10.5px] font-medium leading-[15px]"
                style={{ backgroundColor: `${label.color}1f`, color: label.color }}
              >
                {label.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Sits over the timestamp, which hides itself to make room. */}
      <div className="absolute right-2 top-2 z-20 hidden items-center gap-0.5 rounded-[9px] bg-card/95 p-0.5 shadow-raise group-hover:flex">
        <IconButton
          label={thread.is_starred ? "Remove star" : "Star"}
          onClick={onStar}
          className={thread.is_starred ? "text-warn" : undefined}
        >
          <Star className={thread.is_starred ? "fill-warn" : undefined} />
        </IconButton>
        {view !== "archive" && view !== "trash" ? (
          <IconButton label="Archive" onClick={onArchive}>
            <Archive />
          </IconButton>
        ) : null}
        <IconButton label="Delete" tone="danger" onClick={onTrash}>
          <Trash2 />
        </IconButton>
      </div>
    </div>
  );
}
