"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Attachment, Mailbox, Message } from "@/db/schema";
import { formatAddress, forwardSubject, quoteForReply, replySubject } from "@/lib/mail";
import { cn, colorOf, formatBytes, initialsOf } from "@/lib/utils";
import {
  deleteThreadsAction,
  moveThreadsAction,
  setReadAction,
  setStarAction,
} from "@/server/actions";
import {
  Archive,
  ChevronDown,
  Download,
  Forward,
  Paperclip,
  Reply,
  ReplyAll,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useComposer } from "./composer-provider";
import { EmailFrame } from "./email-frame";

type MessageWithAttachments = Message & { attachments: Attachment[] };

interface Props {
  thread: {
    id: string;
    subject: string;
    isStarred: boolean;
    mailbox: Mailbox;
    messages: MessageWithAttachments[];
  };
  backHref: string;
}

export function ThreadView({ thread, backHref }: Props) {
  const router = useRouter();
  const composer = useComposer();
  const [, startTransition] = useTransition();
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(thread.messages.slice(-1).map((message) => message.id)),
  );

  // Opening a thread marks it read, the same as any desktop client.
  useEffect(() => {
    if (!thread.messages.some((message) => !message.isRead)) return;
    startTransition(async () => {
      await setReadAction([thread.id], true);
      router.refresh();
    });
  }, [thread.id, thread.messages, router]);

  function run(action: () => Promise<unknown>, thenBack = false) {
    startTransition(async () => {
      await action();
      if (thenBack) router.push(backHref);
      router.refresh();
    });
  }

  const last = thread.messages.at(-1)!;

  function replyDraft(mode: "reply" | "replyAll" | "forward") {
    const recipients =
      mode === "forward"
        ? ""
        : last.isOutbound
          ? last.to.map(formatAddress).join(", ")
          : formatAddress({ name: last.fromName, address: last.replyTo ?? last.fromAddress });

    const cc =
      mode === "replyAll"
        ? [...last.to, ...last.cc]
            .filter((entry) => entry.address !== thread.mailbox.address)
            .map(formatAddress)
            .join(", ")
        : "";

    composer.open({
      mailboxId: thread.mailbox.id,
      to: recipients,
      cc,
      subject: mode === "forward" ? forwardSubject(last.subject) : replySubject(last.subject),
      html: quoteForReply({
        fromLabel: last.fromName ?? last.fromAddress,
        sentAt: new Date(last.sentAt ?? last.receivedAt),
        html: last.htmlBody,
        text: last.textBody,
      }),
      threadId: mode === "forward" ? undefined : thread.id,
      inReplyTo: last.rfcMessageId ?? undefined,
      references: [...(last.references ?? []), last.rfcMessageId].filter(Boolean) as string[],
    });
  }

  return (
    <section className="flex h-full min-w-0 flex-col bg-card">
      <header className="flex h-10 shrink-0 items-center gap-0.5 border-b px-2">
        <Action
          label="Archive"
          onClick={() => run(() => moveThreadsAction([thread.id], "archive"), true)}
        >
          <Archive className="size-3.5" />
        </Action>
        <Action
          label="Report spam"
          onClick={() => run(() => moveThreadsAction([thread.id], "spam"), true)}
        >
          <ShieldAlert className="size-3.5" />
        </Action>
        <Action label="Delete" onClick={() => run(() => deleteThreadsAction([thread.id]), true)}>
          <Trash2 className="size-3.5" />
        </Action>
        <Separator
          orientation="vertical"
          className="mx-1 data-vertical:h-4 data-vertical:self-center"
        />
        <Action
          label={thread.isStarred ? "Unstar" : "Star"}
          onClick={() => run(() => setStarAction([thread.id], !thread.isStarred))}
        >
          <Star className={cn("size-3.5", thread.isStarred && "fill-warn text-warn")} />
        </Action>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[12px]"
            onClick={() => replyDraft("reply")}
          >
            <Reply className="size-3.5" />
            Reply
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[12px]"
            onClick={() => replyDraft("replyAll")}
          >
            <ReplyAll className="size-3.5" />
            All
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[12px]"
            onClick={() => replyDraft("forward")}
          >
            <Forward className="size-3.5" />
            Forward
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b px-5 py-4">
          <h1 className="text-[17px] font-semibold leading-snug tracking-[-0.015em]">
            {thread.subject || "(no subject)"}
          </h1>
          <p className="mt-1.5 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
            <span
              className="size-1.5 rounded-full"
              style={{ background: thread.mailbox.color }}
              aria-hidden
            />
            {thread.mailbox.address}
            <span className="opacity-40">|</span>
            {thread.messages.length} {thread.messages.length === 1 ? "message" : "messages"}
          </p>
        </div>

        <ol>
          {thread.messages.map((item, index) => {
            const open = openIds.has(item.id);
            return (
              <li key={item.id} className={cn("px-5 py-3", index > 0 && "border-t")}>
                <button
                  type="button"
                  onClick={() =>
                    setOpenIds((current) => {
                      const next = new Set(current);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                  className="flex w-full items-start gap-2.5 text-left"
                >
                  <span
                    className="mt-px grid size-6 shrink-0 place-items-center rounded-lg font-mono text-[9px] font-semibold text-white"
                    style={{ background: colorOf(item.fromAddress) }}
                    aria-hidden
                  >
                    {initialsOf(item.fromName || item.fromAddress)}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-semibold">
                        {item.fromName || item.fromAddress}
                      </span>
                      <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                        {item.fromAddress}
                      </span>
                      {item.isOutbound && <DeliveryBadge message={item} />}
                      <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted-foreground">
                        {new Date(item.sentAt ?? item.receivedAt).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </span>
                      <ChevronDown
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                          open && "rotate-180",
                        )}
                      />
                    </span>

                    <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted-foreground">
                      to {item.to.map((entry) => entry.address).join(", ") || "—"}
                      {item.cc.length > 0 &&
                        ` · cc ${item.cc.map((entry) => entry.address).join(", ")}`}
                    </span>

                    {!open && (
                      <span className="mt-1 block truncate text-[12px] text-muted-foreground">
                        {item.snippet}
                      </span>
                    )}
                  </span>
                </button>

                {open && (
                  <div className="mt-2 pl-8.5">
                    {!item.isOutbound && <AuthBadges message={item} />}
                    {item.isOutbound && item.deliveryError && (
                      <p className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11.5px] text-destructive">
                        {item.deliveryError}
                      </p>
                    )}
                    <EmailFrame
                      html={item.htmlBody}
                      text={item.textBody}
                      inlineImages={Object.fromEntries(
                        item.attachments
                          .filter((file) => file.isInline && file.contentId)
                          .map((file) => [file.contentId!, `/api/attachments/${file.id}`]),
                      )}
                    />

                    {item.attachments.filter((file) => !file.isInline).length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {item.attachments
                          .filter((file) => !file.isInline)
                          .map((file) => (
                            <li key={file.id}>
                              <a
                                href={`/api/attachments/${file.id}`}
                                className="group flex items-center gap-2 rounded-xl border px-2 py-1.5 transition-colors hover:bg-accent"
                              >
                                <Paperclip className="size-3 text-muted-foreground" />
                                <span className="max-w-56 truncate text-[11.5px]">
                                  {file.filename}
                                </span>
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {formatBytes(file.sizeBytes)}
                                </span>
                                <Download className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                              </a>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/**
 * What SES has told us about this message so far. Needs the configuration set
 * and its SNS subscription to be wired up; without those it stays on "sent".
 */
function DeliveryBadge({ message }: { message: Message }) {
  if (!message.deliveryStatus) return null;

  const tone: Record<string, string> = {
    queued: "border-border text-muted-foreground",
    sent: "border-border text-muted-foreground",
    delivered: "border-ok/30 bg-ok/10 text-ok",
    delayed: "border-warn/30 bg-warn/10 text-warn",
    bounced: "border-destructive/30 bg-destructive/10 text-destructive",
    complained: "border-destructive/30 bg-destructive/10 text-destructive",
    rejected: "border-destructive/30 bg-destructive/10 text-destructive",
    failed: "border-destructive/30 bg-destructive/10 text-destructive",
  };

  return (
    <span
      title={message.deliveryError ?? `SES reported: ${message.deliveryStatus}`}
      className={cn(
        "pill shrink-0 font-mono font-medium",
        tone[message.deliveryStatus] ?? "border-border text-muted-foreground",
      )}
    >
      {message.deliveryStatus}
    </span>
  );
}

function AuthBadges({ message }: { message: Message }) {
  const checks = [
    ["spf", message.spf],
    ["dkim", message.dkim],
    ["dmarc", message.dmarc],
  ] as const;

  const known = checks.filter(([, value]) => value);
  if (known.length === 0) return null;

  return (
    <ul className="mb-2 flex flex-wrap items-center gap-1.5">
      {known.map(([name, value]) => {
        const good = value === "pass";
        return (
          <li
            key={name}
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.06em]",
              good ? "bg-ok/12 text-ok" : "bg-destructive/12 text-destructive",
            )}
          >
            {good ? <ShieldCheck className="size-2.5" /> : <ShieldAlert className="size-2.5" />}
            {name}={value}
          </li>
        );
      })}
    </ul>
  );
}

function Action({
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
          <Button variant="ghost" size="icon" className="size-7 rounded-xl" onClick={onClick}>
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
