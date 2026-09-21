"use client";

import { Avatar, Badge, Button, Hint, IconButton, Separator } from "@/components/kit";
import type { Attachment, Label as LabelRow, Mailbox, Message } from "@/db/schema";
import { formatAddress, forwardSubject, quoteForReply, replySubject } from "@/lib/mail";
import { cn, formatBytes } from "@/lib/utils";
import {
  deleteThreadsAction,
  moveThreadsAction,
  setReadAction,
  setStarAction,
} from "@/server/actions";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  FileText,
  Forward,
  Reply,
  ReplyAll,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useComposer } from "./composer-provider";
import { EmailFrame } from "./email-frame";
import { LabelMenu } from "./label-menu";

type MessageWithAttachments = Message & { attachments: Attachment[] };

interface Props {
  thread: {
    id: string;
    subject: string;
    isStarred: boolean;
    mailbox: Mailbox;
    messages: MessageWithAttachments[];
    labels: { labelId: string; label: LabelRow }[];
  };
  backHref: string;
  /** Every label the user has, so one can be put on this conversation. */
  labels: LabelRow[];
}

export function ThreadView({ thread, backHref, labels }: Props) {
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
      <header className="flex h-12 shrink-0 items-center gap-0.5 border-b border-border px-3">
        {/* On a narrow screen the conversation covers the list, so it needs a
            way back that a wide screen does not. */}
        <IconButton label="Back to the list" size="md" asChild className="mr-1 lg:hidden">
          <Link href={backHref}>
            <ArrowLeft />
          </Link>
        </IconButton>

        <Action
          label="Archive"
          onClick={() => run(() => moveThreadsAction([thread.id], "archive"), true)}
        >
          <Archive />
        </Action>
        <Action
          label="Report spam"
          onClick={() => run(() => moveThreadsAction([thread.id], "spam"), true)}
        >
          <ShieldAlert />
        </Action>
        <Action
          label="Delete"
          destructive
          onClick={() => run(() => deleteThreadsAction([thread.id]), true)}
        >
          <Trash2 />
        </Action>
        <Separator orientation="vertical" className="mx-1.5 h-4 self-center" />
        <LabelMenu
          threadIds={[thread.id]}
          labels={labels}
          applied={thread.labels.map((entry) => entry.labelId)}
        />
        <Action
          label={thread.isStarred ? "Unstar" : "Star"}
          onClick={() => run(() => setStarAction([thread.id], !thread.isStarred))}
        >
          <Star className={cn(thread.isStarred && "fill-warn text-warn")} />
        </Action>

        {/* Replying from a mailbox you may only read would be refused when
            you pressed send, so it is not offered. */}
        {composer.canWriteAs(thread.mailbox.id) ? (
          <div className="ml-auto flex items-center gap-1">
            <Action label="Reply to all" onClick={() => replyDraft("replyAll")}>
              <ReplyAll />
            </Action>
            <Action label="Forward" onClick={() => replyDraft("forward")}>
              <Forward />
            </Action>
            <Button variant="soft" size="sm" pill onClick={() => replyDraft("reply")}>
              <Reply />
              Reply
            </Button>
          </div>
        ) : (
          <span className="ml-auto text-[12px] text-muted-foreground">Read only</span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
        <ol>
          {thread.messages.map((item, index) => {
            const open = openIds.has(item.id);
            const first = index === 0;
            return (
              <li
                key={item.id}
                className={cn(
                  "px-4 py-4",
                  // The opening message reads as the page; replies read as
                  // panels stacked under it.
                  first ? "-mx-4" : "mt-3 rounded-2xl bg-muted/55",
                )}
              >
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
                  className="flex w-full items-start gap-3 text-left"
                >
                  <Avatar size="lg" name={item.fromName} address={item.fromAddress} />

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[14px] font-semibold">
                        {item.fromName || item.fromAddress}
                      </span>
                      <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">
                        {item.fromAddress}
                      </span>
                      {item.isOutbound && <DeliveryBadge message={item} />}
                      <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">
                        {new Date(item.sentAt ?? item.receivedAt).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                      </span>
                    </span>

                    <span className="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
                      <span className="shrink-0">To:</span>
                      <span className="truncate text-foreground/75">
                        {item.to.map((entry) => entry.name || entry.address).join(", ") || "—"}
                      </span>
                      {item.cc.length > 0 && (
                        <span className="truncate">
                          · cc {item.cc.map((entry) => entry.address).join(", ")}
                        </span>
                      )}
                      <ChevronDown
                        className={cn(
                          "size-3.5 shrink-0 transition-transform duration-150",
                          open && "rotate-180",
                        )}
                      />
                    </span>

                    {!open && (
                      <span className="mt-1.5 block truncate text-[12.5px] text-muted-foreground">
                        {item.snippet}
                      </span>
                    )}
                  </span>
                </button>

                {open && (
                  <div className="mt-4">
                    {/* The subject belongs to the conversation, so it is
                        stated once, above the message that started it. */}
                    {first && (
                      <div className="mb-3">
                        <h1 className="font-display text-[19px] font-semibold leading-snug tracking-[-0.02em]">
                          {thread.subject || "(no subject)"}
                        </h1>
                        {thread.labels.length > 0 && (
                          <ul className="mt-2 flex flex-wrap gap-1.5">
                            {thread.labels.map((entry) => (
                              <li
                                key={entry.labelId}
                                className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11.5px]"
                              >
                                <span
                                  className="size-2 rounded-full"
                                  style={{ background: entry.label.color }}
                                  aria-hidden
                                />
                                {entry.label.name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {!item.isOutbound && <AuthBadges message={item} />}
                    {item.isOutbound && item.deliveryError && (
                      <p className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-[12px] text-destructive">
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
                      <ul className="mt-4 flex flex-wrap gap-2">
                        {item.attachments
                          .filter((file) => !file.isInline)
                          .map((file) => (
                            <li key={file.id}>
                              <a
                                href={`/api/attachments/${file.id}`}
                                className="flex items-center gap-3 rounded-xl bg-muted px-3 py-2.5 transition-colors hover:bg-accent"
                              >
                                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-card text-muted-foreground shadow-raise">
                                  <FileText className="size-4" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block max-w-56 truncate text-[12.5px] font-medium">
                                    {file.filename}
                                  </span>
                                  <span className="block text-[11.5px] text-muted-foreground">
                                    {formatBytes(file.sizeBytes)} &middot;{" "}
                                    <span className="text-primary">Download</span>
                                  </span>
                                </span>
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

  const tone = {
    queued: "neutral",
    sent: "neutral",
    delivered: "ok",
    delayed: "warn",
    bounced: "danger",
    complained: "danger",
    rejected: "danger",
    failed: "danger",
  } as const;

  return (
    <Badge
      size="sm"
      tone={tone[message.deliveryStatus as keyof typeof tone] ?? "neutral"}
      title={message.deliveryError ?? `SES reported: ${message.deliveryStatus}`}
      className="shrink-0"
    >
      {message.deliveryStatus}
    </Badge>
  );
}

function AuthBadges({ message }: { message: Message }) {
  const checks = [
    ["SPF", message.spf],
    ["DKIM", message.dkim],
    ["DMARC", message.dmarc],
  ] as const;

  const known = checks.filter(([, value]) => value);
  if (known.length === 0) return null;

  return (
    <ul className="mb-3 flex flex-wrap items-center gap-1.5">
      {known.map(([name, value]) => {
        // "none" and "neutral" mean the domain published no policy to check
        // against, which is not the same as a message failing one.
        const tone =
          value === "pass" ? "ok" : value === "none" || value === "neutral" ? "neutral" : "danger";
        return (
          <li key={name}>
            <Badge size="sm" tone={tone} title={`${name} ${value}`}>
              {tone === "ok" ? (
                <ShieldCheck />
              ) : tone === "danger" ? (
                <ShieldAlert />
              ) : (
                <ShieldOff />
              )}
              {name}
              <span className="font-normal opacity-70">{value}</span>
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function Action({
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
      <IconButton
        label={label}
        size="md"
        variant={destructive ? "danger" : "ghost"}
        onClick={onClick}
      >
        {children}
      </IconButton>
    </Hint>
  );
}
