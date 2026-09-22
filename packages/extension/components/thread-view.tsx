import { type ThreadPatch, replyUrl, threadUrl } from "@/lib/api";
import { cx, displayName, formatAddress, formatBytes, fullTime, shortTime } from "@/lib/format";
import { openTab } from "@/lib/hooks";
import { prepareEmail, textToHtml } from "@/lib/sanitize";
import type { Settings } from "@/lib/settings";
import { type ApiMessage, type ApiThread, VIEW_FOLDER, type View } from "@/lib/types";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Forward,
  Image as ImageIcon,
  Mail,
  MailOpen,
  Paperclip,
  Reply,
  ReplyAll,
  ShieldAlert,
  Star,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { EmailFrame } from "./email-frame";
import { Avatar, Button, IconButton, Spinner } from "./kit";

/**
 * A conversation, read.
 *
 * Reading, triage and deleting happen here. Writing does not: composing in a
 * 400-pixel popup with no drafts, no attachments and no signature would be a
 * worse version of something that already exists one click away, so every
 * reply hands over to the dashboard with the box already open.
 */

interface Props {
  thread: ApiThread | null;
  loading: boolean;
  error: string | null;
  view: View;
  settings: Settings;
  dark: boolean;
  onBack: () => void;
  onPatch: (patch: ThreadPatch) => void;
  onTrash: () => void;
  /** Whether the back arrow is worth drawing; in two panes it is not. */
  showBack: boolean;
  /**
   * Whether there is a whole window to fill rather than 400 pixels.
   *
   * Only changes how wide the text is allowed to run: a line of body copy
   * stretched across a desktop monitor is unreadable, so it is capped and
   * centred instead.
   */
  roomy?: boolean;
}

export function ThreadView({
  thread,
  loading,
  error,
  view,
  settings,
  dark,
  onBack,
  onPatch,
  onTrash,
  showBack,
  roomy = false,
}: Props) {
  const folder = VIEW_FOLDER[view];
  /** The column everything in here lines up to. */
  const column = roomy ? "mx-auto w-full max-w-[860px]" : "w-full";

  if (loading && !thread) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <div className="text-[13.5px] font-semibold">That conversation would not open</div>
        <div className="text-[12.5px] text-muted-foreground">{error}</div>
        {showBack ? (
          <Button size="sm" variant="outline" onClick={onBack}>
            Back
          </Button>
        ) : null}
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <MailOpen className="size-5" />
        </div>
        <div className="text-[14px] font-semibold">Nothing open</div>
        <p className="max-w-[280px] text-[12.5px] leading-relaxed text-muted-foreground">
          Pick a conversation on the left and it will be read here.
        </p>
      </div>
    );
  }

  const messages = thread.messages ?? [];
  const unread = thread.unread_count > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="shrink-0 border-b border-border bg-card px-2 py-1.5">
        <div className={cx("flex items-center gap-0.5", column, roomy && "px-2")}>
          {showBack ? (
            <IconButton label="Back" onClick={onBack}>
              <ArrowLeft />
            </IconButton>
          ) : null}

          <IconButton
            label={thread.is_starred ? "Remove star" : "Star"}
            active={thread.is_starred}
            onClick={() => onPatch({ is_starred: !thread.is_starred })}
          >
            <Star className={thread.is_starred ? "fill-warn text-warn" : undefined} />
          </IconButton>

          <IconButton
            label={unread ? "Mark as read" : "Mark as unread"}
            onClick={() => onPatch({ is_read: unread })}
          >
            {unread ? <MailOpen /> : <Mail />}
          </IconButton>

          <IconButton label="Archive" onClick={() => onPatch({ folder: "archive" })}>
            <Archive />
          </IconButton>

          <IconButton label="Mark as spam" onClick={() => onPatch({ folder: "spam" })}>
            <ShieldAlert />
          </IconButton>

          <IconButton label="Delete" tone="danger" onClick={onTrash}>
            <Trash2 />
          </IconButton>

          <div className="ml-auto flex items-center gap-1">
            <IconButton
              label="Open in Mailroom"
              onClick={() => openTab(threadUrl(settings, thread, folder))}
            >
              <ExternalLink />
            </IconButton>
            <Button
              size="sm"
              pill
              onClick={() => openTab(replyUrl(settings, thread, folder, "reply"))}
            >
              <Reply />
              Reply
            </Button>
          </div>
        </div>
      </div>

      {/* the conversation */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cx("px-4 pb-6 pt-4", column, roomy && "px-6 pt-6")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-[16px] font-semibold leading-tight tracking-[-0.015em]">
              {thread.subject?.trim() || "(no subject)"}
            </h1>
            {(thread.labels ?? []).map((label) => (
              <span
                key={label.id}
                className="pill border-transparent font-medium"
                style={{ backgroundColor: `${label.color}1f`, color: label.color }}
              >
                <span className="size-1.5 rounded-full" style={{ backgroundColor: label.color }} />
                {label.name}
              </span>
            ))}
          </div>

          {thread.mailbox ? (
            <div className="mt-1 font-mono text-[11.5px] text-muted-foreground">
              {thread.mailbox}
            </div>
          ) : null}

          <div className="mt-4 space-y-2">
            {messages.map((message, index) => (
              <MessagePanel
                key={message.id}
                message={message}
                dark={dark}
                defaultOpen={index === messages.length - 1}
                onOpenInApp={() => openTab(threadUrl(settings, thread, folder))}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              pill
              onClick={() => openTab(replyUrl(settings, thread, folder, "replyAll"))}
            >
              <ReplyAll />
              Reply to all
            </Button>
            <Button
              size="sm"
              variant="outline"
              pill
              onClick={() => openTab(replyUrl(settings, thread, folder, "forward"))}
            >
              <Forward />
              Forward
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- one message */

function MessagePanel({
  message,
  dark,
  defaultOpen,
  onOpenInApp,
}: {
  message: ApiMessage;
  dark: boolean;
  defaultOpen: boolean;
  /** Downloading a file needs the key in a header, which a link cannot carry,
   *  so an attachment hands the reader to the dashboard instead. */
  onOpenInApp: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showImages, setShowImages] = useState(false);

  const prepared = useMemo(() => {
    if (message.html?.trim()) return prepareEmail(message.html, { showRemoteImages: showImages });
    if (message.text?.trim()) {
      return { html: textToHtml(message.text), remoteImages: 0, blockedImages: 0 };
    }
    return { html: "", remoteImages: 0, blockedImages: 0 };
  }, [message.html, message.text, showImages]);

  const attachments = (message.attachments ?? []).filter((file) => !file.is_inline);
  const when = message.sent_at ?? message.received_at;

  return (
    <div className="overflow-hidden rounded-[11px] border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-accent/50"
      >
        <Avatar name={message.from.name} address={message.from.address} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
              {displayName(message.from)}
            </span>
            <span
              title={fullTime(when)}
              className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
            >
              {shortTime(when)}
            </span>
          </span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {open
              ? `to ${message.to.map((entry) => displayName(entry)).join(", ") || "undisclosed"}`
              : message.snippet || ""}
          </span>
        </span>
        <ChevronDown
          className={cx(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-border px-3 py-3">
          <div className="mb-2 space-y-0.5 font-mono text-[11px] text-muted-foreground">
            <div className="truncate">from {formatAddress(message.from)}</div>
            {message.cc.length > 0 ? (
              <div className="truncate">
                cc {message.cc.map((entry) => entry.address).join(", ")}
              </div>
            ) : null}
          </div>

          {prepared.blockedImages > 0 ? (
            <button
              type="button"
              onClick={() => setShowImages(true)}
              className="mb-2 flex w-full items-center gap-2 rounded-[9px] border border-warn/30 bg-warn-soft px-2.5 py-1.5 text-left text-[11.5px]"
            >
              <ImageIcon className="size-3.5 shrink-0" />
              <span className="flex-1">
                {prepared.blockedImages} remote{" "}
                {prepared.blockedImages === 1 ? "image is" : "images are"} not loaded
              </span>
              <span className="font-medium underline">Show</span>
            </button>
          ) : null}

          {prepared.html ? (
            <EmailFrame html={prepared.html} dark={dark} />
          ) : (
            <div className="text-[12.5px] italic text-muted-foreground">
              This message has no body.
            </div>
          )}

          {attachments.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {attachments.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={onOpenInApp}
                  title={`${file.filename} — open in Mailroom to download`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-[8px] border border-border bg-muted/60 px-2 py-1 text-[11.5px] transition hover:bg-accent"
                >
                  <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{file.filename}</span>
                  {file.size_bytes ? (
                    <span className="shrink-0 text-muted-foreground">
                      {formatBytes(file.size_bytes)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
