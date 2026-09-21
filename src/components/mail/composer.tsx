"use client";

import {
  Button,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/kit";
import type { Mailbox } from "@/db/schema";
import { cn, formatBytes } from "@/lib/utils";
import { deleteDraftAction, saveDraftAction, sendMessageAction } from "@/server/actions";
import { Loader2, Maximize2, Minimize2, Paperclip, Send, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RecipientInput } from "./recipient-input";
import { RichEditor } from "./rich-editor";

export interface ComposerDraft {
  draftId?: string;
  mailboxId?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  html?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
}

interface StagedFile {
  id: string;
  filename: string;
  sizeBytes: number;
}

interface Props {
  draft: ComposerDraft;
  mailboxes: Mailbox[];
  defaultMailboxId?: string | null;
  onClose: () => void;
}

export function Composer({ draft, mailboxes, defaultMailboxId, onClose }: Props) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [mailboxId, setMailboxId] = useState(
    draft.mailboxId ?? defaultMailboxId ?? mailboxes[0]?.id ?? "",
  );
  const [to, setTo] = useState(draft.to ?? "");
  const [cc, setCc] = useState(draft.cc ?? "");
  const [bcc, setBcc] = useState(draft.bcc ?? "");
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [html, setHtml] = useState(draft.html ?? "");
  const [showCc, setShowCc] = useState(Boolean(draft.cc || draft.bcc));
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draftId, setDraftId] = useState(draft.draftId);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const signature = mailboxes.find((box) => box.id === mailboxId)?.signature;

  // Autosave, so a closed tab never loses a half-written message.
  useEffect(() => {
    if (!mailboxId) return;
    if (!to && !subject && !html) return;

    const timer = setTimeout(async () => {
      try {
        const result = await saveDraftAction({
          draftId,
          mailboxId,
          to,
          cc,
          bcc,
          subject,
          html,
          threadId: draft.threadId,
        });
        setDraftId(result.draftId);
        setSavedAt(
          new Date().toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
        );
      } catch {
        // Autosave is best effort; sending still reports real errors.
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [to, cc, bcc, subject, html, mailboxId, draftId, draft.threadId]);

  async function upload(selected: FileList | null) {
    if (!selected || selected.length === 0) return;
    setUploading(true);

    const form = new FormData();
    for (const file of selected) form.append("files", file);

    try {
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Upload failed");
      setFiles((current) => [...current, ...body.attachments]);
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function send() {
    setSending(true);
    try {
      await sendMessageAction({
        draftId,
        mailboxId,
        to,
        cc,
        bcc,
        subject,
        html: signature ? `${html}<br/><br/>${signature}` : html,
        threadId: draft.threadId,
        inReplyTo: draft.inReplyTo,
        references: draft.references,
        attachmentIds: files.map((file) => file.id),
      });
      toast.success("Message sent");
      onClose();
      router.refresh();
    } catch (sendError) {
      toast.error(sendError instanceof Error ? sendError.message : "Could not send");
      setSending(false);
    }
  }

  async function discard() {
    if (draftId) await deleteDraftAction(draftId);
    onClose();
    router.refresh();
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void send();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className={cn(
        "overlay-shadow fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-card",
        // On a phone the composer is the screen; on a desktop it docks bottom-right.
        expanded
          ? "inset-2 sm:inset-6"
          : "inset-x-0 bottom-0 h-[min(32rem,100dvh)] rounded-b-none sm:inset-x-auto sm:right-5 sm:bottom-0 sm:w-[min(40rem,calc(100vw-2.5rem))]",
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4">
        <h2 className="flex-1 truncate text-[13px] font-semibold">
          {draft.threadId ? "Reply" : "New message"}
        </h2>
        {savedAt && <span className="text-[11px] text-muted-foreground">Saved {savedAt}</span>}
        <IconButton
          label={expanded ? "Shrink" : "Expand"}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </IconButton>
        <IconButton label="Close" onClick={onClose}>
          <X />
        </IconButton>
      </header>

      <div className="shrink-0 border-b border-border">
        <Row label="From">
          <Select value={mailboxId} onValueChange={(value) => value && setMailboxId(value)}>
            <SelectTrigger size="bare" className="pr-3 text-[13px]">
              <SelectValue placeholder="Pick a mailbox" />
            </SelectTrigger>
            <SelectContent>
              {mailboxes.map((box) => (
                <SelectItem key={box.id} value={box.id}>
                  <span
                    className="mr-1.5 inline-block size-1.5 rounded-full align-middle"
                    style={{ background: box.color }}
                  />
                  <span className="font-mono text-[12.5px]">{box.address}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>

        <Row
          label="To"
          action={
            !showCc && (
              <button
                type="button"
                className="shrink-0 px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowCc(true)}
              >
                Cc / Bcc
              </button>
            )
          }
        >
          <RecipientInput
            value={to}
            onChange={setTo}
            ariaLabel="To recipients"
            placeholder="Type an address, then Enter"
          />
        </Row>

        {showCc && (
          <>
            <Row label="Cc">
              <RecipientInput value={cc} onChange={setCc} ariaLabel="Cc recipients" />
            </Row>
            <Row label="Bcc">
              <RecipientInput value={bcc} onChange={setBcc} ariaLabel="Bcc recipients" />
            </Row>
          </>
        )}

        <Row label="Subject">
          <FieldInput value={subject} onChange={setSubject} placeholder="Subject" mono={false} />
        </Row>
      </div>

      <RichEditor
        value={html}
        onChange={setHtml}
        placeholder="Write your message…"
        className="min-h-0 flex-1"
      />

      {files.length > 0 && (
        <ul className="flex shrink-0 flex-wrap gap-1.5 border-t border-border px-4 py-2.5">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-[11.5px]"
            >
              <Paperclip className="size-3 text-muted-foreground" />
              <span className="max-w-44 truncate">{file.filename}</span>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {formatBytes(file.sizeBytes)}
              </span>
              <button
                type="button"
                onClick={() => setFiles((current) => current.filter((f) => f.id !== file.id))}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${file.filename}`}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-border px-4">
        <Button
          variant="solid"
          size="md"
          pill
          onClick={send}
          loading={sending}
          disabled={!to.trim() || !mailboxId}
        >
          {!sending && <Send />}
          Send
        </Button>

        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => upload(event.target.files)}
        />
        <IconButton
          size="md"
          label="Attach files"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
        </IconButton>

        <span className="ml-auto hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
          <span className="kbd">⌘</span>
          <span className="kbd">↵</span>
          send
        </span>

        <IconButton size="md" variant="danger" label="Discard draft" onClick={discard}>
          <Trash2 />
        </IconButton>
      </footer>
    </div>
  );
}

function FieldInput({
  value,
  onChange,
  placeholder,
  mono = true,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <Input
      variant="bare"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cn("h-10 text-[13.5px]", mono && "font-mono text-[12.5px]")}
    />
  );
}

function Row({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-stretch border-b border-border last:border-b-0">
      <span className="flex w-16 shrink-0 items-center pl-4 text-[12.5px] text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      {action}
    </div>
  );
}
