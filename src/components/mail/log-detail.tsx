"use client";

import {
  Badge,
  Button,
  List,
  ListRow,
  Note,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/kit";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  MousePointerClick,
  Paperclip,
  Send,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

export interface DetailEvent {
  id: string;
  type: string;
  detail: string | null;
  recipient: string | null;
  occurredAt: Date;
}

export interface DetailProps {
  id: string;
  subject: string;
  fromName: string | null;
  fromAddress: string;
  to: { name: string | null; address: string }[];
  cc: { name: string | null; address: string }[];
  replyTo: string | null;
  html: string | null;
  text: string | null;
  deliveryStatus: string | null;
  deliveryError: string | null;
  sesMessageId: string | null;
  rfcMessageId: string | null;
  isOutbound: boolean;
  isTest: boolean;
  scheduledAt: Date | null;
  openedAt: Date | null;
  openCount: number;
  sizeBytes: number;
  at: Date;
  mailbox: string;
  apiKey: { id: string; name: string; mode: string } | null;
  attachments: { id: string; filename: string; sizeBytes: number }[];
  events: DetailEvent[];
  /** Only inbound mail keeps its original source. */
  hasRaw: boolean;
}

const ICON: Record<string, typeof Send> = {
  send: Send,
  delivery: CheckCircle2,
  bounce: XCircle,
  complaint: AlertTriangle,
  reject: Ban,
  open: Eye,
  click: MousePointerClick,
  delivery_delay: Clock,
  rendering_failure: AlertTriangle,
  subscription: Ban,
};

const LABEL: Record<string, string> = {
  send: "Sent",
  delivery: "Delivered",
  bounce: "Bounced",
  complaint: "Marked as spam",
  reject: "Rejected",
  open: "Opened",
  click: "Link clicked",
  delivery_delay: "Delayed",
  rendering_failure: "Render failed",
  subscription: "Unsubscribed",
};

/**
 * What each event means, said in colour.
 *
 * This used to be a two-way split — a failure, or everything else — which
 * painted "Delivered" the same grey as "Sent". Arriving is the outcome the
 * whole screen is read for; it should be the one thing that looks settled.
 */
const TONE: Record<string, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  send: "neutral",
  delivery: "ok",
  open: "info",
  click: "info",
  delivery_delay: "warn",
  subscription: "warn",
  bounce: "danger",
  complaint: "danger",
  reject: "danger",
  rendering_failure: "danger",
};

/** The icon's disc, matched to the same tone as its badge. */
const DISC: Record<string, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-destructive",
  info: "bg-info-soft text-info",
  neutral: "bg-muted text-muted-foreground",
};

export function LogDetail(props: DetailProps) {
  const first = props.to[0]?.address ?? props.fromAddress;

  return (
    <div className="space-y-6 py-6">
      <div>
        <Link
          href="/settings/logs"
          className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Email log
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-[20px] font-semibold tracking-[-0.01em]">{first}</h1>
          {props.isTest && <Badge tone="outline">test send</Badge>}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <Cell
          label="From"
          value={props.fromName ? `${props.fromName} <${props.fromAddress}>` : props.fromAddress}
        />
        <Cell label="Subject" value={props.subject || "(no subject)"} />
        <Cell label="To" value={props.to.map((entry) => entry.address).join(", ") || "—"} />
        <Cell label="Message id" value={props.id} copy mono />
      </dl>

      {(props.apiKey || props.scheduledAt || props.deliveryError) && (
        <div className="space-y-2">
          {props.apiKey && (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="text-muted-foreground">Sent through</span>
              <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12px]">
                POST /v1/emails
              </code>
              <span className="text-muted-foreground">with key</span>
              <Badge size="sm" tone={props.apiKey.mode === "test" ? "warn" : "neutral"}>
                {props.apiKey.name}
              </Badge>
            </div>
          )}
          {props.scheduledAt && <Note>Scheduled for {props.scheduledAt.toLocaleString()}.</Note>}
          {props.deliveryError && (
            <p className="rounded-xl bg-danger-soft px-3 py-2 text-[12.5px] text-destructive">
              {props.deliveryError}
            </p>
          )}
        </div>
      )}

      <Timeline events={props.events} status={props.deliveryStatus} at={props.at} />

      {props.attachments.length > 0 && (
        <div>
          <p className="mb-2 text-[12.5px] font-semibold">Attachments</p>
          <List>
            {props.attachments.map((file) => (
              <ListRow key={file.id} className="py-2">
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{file.filename}</span>
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {size(file.sizeBytes)}
                </span>
              </ListRow>
            ))}
          </List>
        </div>
      )}

      <Body {...props} />
    </div>
  );
}

function Cell({
  label,
  value,
  copy,
  mono,
}: {
  label: string;
  value: string;
  copy?: boolean;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-[13px]",
          mono && "font-mono text-[12px]",
        )}
      >
        <span className="min-w-0 truncate" title={value}>
          {value}
        </span>
        {copy && (
          <button
            type="button"
            aria-label={`Copy ${label}`}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => {
              navigator.clipboard.writeText(value).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
                toast.success("Copied");
              });
            }}
          >
            {copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
          </button>
        )}
      </dd>
    </div>
  );
}

/**
 * What happened to the message, in order.
 *
 * Read left to right rather than as a list: the question being asked here is
 * almost always "did it arrive, and if not how far did it get".
 */
function Timeline({
  events,
  status,
  at,
}: {
  events: DetailEvent[];
  status: string | null;
  at: Date;
}) {
  // Nothing from SES yet means the app's own record is all there is to show.
  const steps =
    events.length > 0
      ? events
      : status
        ? [
            {
              id: "local",
              type: status === "queued" ? "send" : "send",
              detail: null,
              recipient: null,
              occurredAt: at,
            },
          ]
        : [];

  if (steps.length === 0) {
    return (
      <div>
        <p className="mb-2 text-[12.5px] font-semibold">Events</p>
        <Note>
          Nothing reported yet. SES reports through the pipeline on the Delivery reporting screen;
          without it a message stays on the status the app recorded when it sent.
        </Note>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-[12.5px] font-semibold">Events</p>
      <div className="overflow-x-auto rounded-xl border border-border border-dashed p-4">
        <ol className="flex min-w-max items-start gap-0">
          {steps.map((event, index) => {
            const Icon = ICON[event.type] ?? Clock;
            const tone = TONE[event.type] ?? "neutral";
            return (
              <li key={event.id} className="flex items-start">
                {index > 0 && (
                  <span
                    aria-hidden
                    // Coloured by the step it leads into, so the line into a
                    // bounce does not look like the line into a delivery.
                    className={cn(
                      "mt-5 h-px w-12 sm:w-20",
                      tone === "danger"
                        ? "bg-destructive/40"
                        : tone === "ok"
                          ? "bg-ok/40"
                          : "bg-border",
                    )}
                  />
                )}
                <div className="flex w-28 flex-col items-center gap-1.5 text-center sm:w-32">
                  <span
                    className={cn(
                      "grid size-9 place-items-center rounded-xl [&_svg]:size-4",
                      DISC[tone],
                    )}
                  >
                    <Icon />
                  </span>
                  <Badge size="sm" tone={tone}>
                    {LABEL[event.type] ?? event.type}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {event.occurredAt.toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  {event.detail && (
                    <span className="text-[11px] text-muted-foreground">{event.detail}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** The message itself: what it looked like, and what it was made of. */
function Body(props: DetailProps) {
  const tabs = [
    props.html && "preview",
    props.text && "text",
    props.html && "html",
    "headers",
  ].filter(Boolean) as string[];

  if (tabs.length === 1) {
    return <Note>This message has no stored body.</Note>;
  }

  return (
    <Tabs defaultValue={tabs[0]} className="rounded-xl border border-border p-3">
      <TabsList>
        {props.html && <TabsTrigger value="preview">Preview</TabsTrigger>}
        {props.text && <TabsTrigger value="text">Plain text</TabsTrigger>}
        {props.html && <TabsTrigger value="html">HTML</TabsTrigger>}
        <TabsTrigger value="headers">Details</TabsTrigger>
      </TabsList>

      {props.html && (
        <TabsContent value="preview" className="mt-3">
          {/* Sandboxed with no allow-* flags: the body is somebody else's HTML
              and must not run scripts or reach the network from this origin. */}
          <iframe
            title="Message preview"
            sandbox=""
            srcDoc={props.html}
            className="h-[32rem] w-full rounded-lg border border-border bg-white"
          />
        </TabsContent>
      )}

      {props.text && (
        <TabsContent value="text" className="mt-3">
          <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted p-3 font-mono text-[12.5px] whitespace-pre-wrap">
            {props.text}
          </pre>
        </TabsContent>
      )}

      {props.html && (
        <TabsContent value="html" className="mt-3">
          <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted p-3 font-mono text-[12.5px] whitespace-pre-wrap">
            {props.html}
          </pre>
        </TabsContent>
      )}

      <TabsContent value="headers" className="mt-3">
        <List>
          <Meta label="Mailbox" value={props.mailbox} />
          <Meta label="Message-ID" value={props.rfcMessageId ?? "—"} mono />
          <Meta label="SES id" value={props.sesMessageId ?? "—"} mono />
          {props.replyTo && <Meta label="Reply-To" value={props.replyTo} />}
          {props.cc.length > 0 && (
            <Meta label="Cc" value={props.cc.map((entry) => entry.address).join(", ")} />
          )}
          <Meta label="Size" value={size(props.sizeBytes)} />
          {props.openCount > 0 && (
            <Meta
              label="Opens"
              value={`${props.openCount}, first ${props.openedAt?.toLocaleString() ?? "unknown"}`}
            />
          )}
          {props.hasRaw && (
            <ListRow className="py-2">
              <span className="min-w-0 flex-1 text-[13px]">Original source</span>
              <Button asChild variant="outline" size="sm" pill>
                <a href={`/api/v1/messages/${props.id}/raw`}>Download .eml</a>
              </Button>
            </ListRow>
          )}
        </List>
        {!props.hasRaw && props.isOutbound && (
          <Note className="mt-2">
            Outgoing mail is not kept in its raw form — the app hands SES the parts, and SES builds
            the message. The HTML and text above are exactly what was sent.
          </Note>
        )}
      </TabsContent>
    </Tabs>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <ListRow className="py-2">
      <span className="w-28 shrink-0 text-[12.5px] text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 flex-1 truncate text-[13px]", mono && "font-mono text-[12px]")}>
        {value}
      </span>
    </ListRow>
  );
}

function size(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
