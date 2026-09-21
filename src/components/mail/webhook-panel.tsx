"use client";

import {
  BlankSlate,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  Fieldset,
  FieldsetActions,
  IconButton,
  Input,
  List,
  ListRow,
  Note,
  Panel,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  StatusPill,
  Switch,
} from "@/components/kit";
import type { Mailbox, Webhook, WebhookDelivery } from "@/db/schema";
import { useSubmit } from "@/lib/use-submit";
import { cn } from "@/lib/utils";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_NOTES } from "@/lib/webhook-events";
import {
  createWebhookAction,
  deleteWebhookAction,
  pingWebhookAction,
  rotateWebhookSecretAction,
  updateWebhookAction,
} from "@/server/actions";
import {
  Check,
  Copy,
  MoreHorizontal,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
  Webhook as WebhookIcon,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * One control, three kinds of answer.
 *
 * The scope used to be a mailbox or nothing, which meant an account sending
 * for several domains had to make one endpoint per mailbox to hear about a
 * single domain — and another one every time a mailbox was added to it.
 */
const EVERYTHING = "__all__";

function scopeValue(scope: { mailboxId?: string | null; domainId?: string | null }) {
  if (scope.mailboxId) return `mailbox:${scope.mailboxId}`;
  if (scope.domainId) return `domain:${scope.domainId}`;
  return EVERYTHING;
}

function scopeParts(value: string) {
  const [kind, id] = value.split(":");
  return {
    mailboxId: kind === "mailbox" ? (id ?? null) : null,
    domainId: kind === "domain" ? (id ?? null) : null,
  };
}

interface Props {
  webhooks: Webhook[];
  deliveries: WebhookDelivery[];
  mailboxes: Mailbox[];
  domains: { id: string; name: string }[];
}

export function WebhookPanel({ webhooks, deliveries, mailboxes, domains }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saving, submit] = useSubmit();

  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [all, setAll] = useState(true);
  const [events, setEvents] = useState<string[]>([]);
  const [scope, setScope] = useState(EVERYTHING);
  const [fresh, setFresh] = useState<{ id: string; secret: string } | null>(null);

  function toggleEvent(event: string) {
    setAll(false);
    setEvents((current) =>
      current.includes(event) ? current.filter((entry) => entry !== event) : [...current, event],
    );
  }

  return (
    <>
      <Panel
        title="Webhooks"
        description="Have Mailroom call your application when mail arrives, is delivered, bounces or is opened — instead of asking it over and over."
        meta={`${webhooks.filter((hook) => hook.enabled).length} active`}
      >
        {fresh && <FreshSecret secret={fresh.secret} />}

        {webhooks.length === 0 ? (
          <BlankSlate
            icon={<WebhookIcon />}
            title="No endpoints yet"
            hint="Add a URL below and this instance will post a signed JSON body to it every time something happens to your mail."
          />
        ) : (
          <List>
            {webhooks.map((hook) => (
              <ListRow key={hook.id} className="items-start">
                <WebhookIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13px] font-medium">
                    <span className="min-w-0 truncate">{hook.url}</span>
                    <StatusPill
                      state={
                        !hook.enabled ? "bad" : hook.consecutiveFailures > 0 ? "pending" : "ok"
                      }
                    >
                      {!hook.enabled
                        ? "Off"
                        : hook.consecutiveFailures > 0
                          ? `${hook.consecutiveFailures} failing`
                          : "Live"}
                    </StatusPill>
                  </p>
                  {hook.description && (
                    <p className="truncate text-[12px] text-muted-foreground">{hook.description}</p>
                  )}
                  <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11.5px] text-muted-foreground">
                    {/* Scope first: which mail an endpoint hears about decides
                        whether it is the one you are looking at. */}
                    <span className="shrink-0 rounded bg-muted px-1.5 py-px">
                      {hook.mailboxId
                        ? (mailboxes.find((box) => box.id === hook.mailboxId)?.address ??
                          "one mailbox")
                        : hook.domainId
                          ? `@${domains.find((entry) => entry.id === hook.domainId)?.name ?? "one domain"}`
                          : "whole account"}
                    </span>
                    <span className="truncate">
                      {hook.events.includes("*") ? "all events" : hook.events.join("  ")}
                    </span>
                  </p>
                  {hook.lastError && !hook.enabled && (
                    <p className="mt-0.5 truncate text-[11.5px] text-destructive">
                      {hook.lastError}
                    </p>
                  )}
                </div>

                <span className="flex w-8 shrink-0 justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton variant="ghost" label="Actions for this endpoint">
                        <MoreHorizontal />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() =>
                          start(async () => {
                            const result = await pingWebhookAction(hook.id);
                            if (result.ok) toast.success(`Endpoint replied ${result.status}`);
                            else toast.error(result.error);
                            router.refresh();
                          })
                        }
                      >
                        <Zap />
                        Send a test event
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          start(async () => {
                            await updateWebhookAction(hook.id, { enabled: !hook.enabled });
                            router.refresh();
                          })
                        }
                      >
                        {hook.enabled ? <PowerOff /> : <Power />}
                        {hook.enabled ? "Turn off" : "Turn on"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          start(async () => {
                            const result = await rotateWebhookSecretAction(hook.id);
                            if (!result.ok) {
                              toast.error(result.error);
                              return;
                            }
                            setFresh({ id: hook.id, secret: result.secret });
                            router.refresh();
                          })
                        }
                      >
                        <RefreshCw />
                        Replace the secret
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        destructive
                        onSelect={() =>
                          start(async () => {
                            await deleteWebhookAction(hook.id);
                            router.refresh();
                          })
                        }
                      >
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </ListRow>
            ))}
          </List>
        )}

        <Fieldset title="Add an endpoint">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="URL" htmlFor="hook-url" hint="Must be https.">
              <Input
                id="hook-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mailroom"
              />
            </Field>
            <Field label="What it is for" htmlFor="hook-note">
              <Input
                id="hook-note"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Support desk"
              />
            </Field>
          </div>

          <Field
            className="mt-4"
            label="What it hears about"
            htmlFor="hook-scope"
            hint="A domain covers every address on it, including ones added later."
          >
            <Select value={scope} onValueChange={(value) => value && setScope(value)}>
              <SelectTrigger id="hook-scope" className="text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EVERYTHING}>Everything in this account</SelectItem>
                {domains.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>One domain</SelectLabel>
                    {domains.map((entry) => (
                      <SelectItem key={entry.id} value={`domain:${entry.id}`} className="font-mono">
                        @{entry.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {mailboxes.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>One mailbox</SelectLabel>
                    {mailboxes.map((box) => (
                      <SelectItem key={box.id} value={`mailbox:${box.id}`} className="font-mono">
                        {box.address}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </Field>

          <div className="mt-4">
            <p className="eyebrow pb-2">Events</p>
            <div className="overflow-hidden rounded-xl border border-border">
              <label
                htmlFor="hook-all-events"
                className="flex cursor-pointer items-center gap-3 border-border border-b bg-muted/40 px-3.5 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium">Everything</span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    Including events added to Mailroom later
                  </span>
                </span>
                <Switch
                  id="hook-all-events"
                  checked={all}
                  onCheckedChange={(on) => {
                    setAll(on);
                    if (on) setEvents([]);
                  }}
                />
              </label>

              <div className={cn("divide-y divide-border", all && "opacity-50")}>
                {WEBHOOK_EVENTS.map((event) => (
                  <label
                    key={event}
                    htmlFor={`hook-event-${event}`}
                    className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px]">{WEBHOOK_EVENT_NOTES[event]}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {event}
                      </span>
                    </span>
                    <Switch
                      id={`hook-event-${event}`}
                      checked={all || events.includes(event)}
                      disabled={all}
                      onCheckedChange={() => toggleEvent(event)}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>

          <FieldsetActions note="The signing secret is shown once when the endpoint is made.">
            <Button
              variant="solid"
              pill
              loading={saving}
              disabled={!url.trim() || saving || (!all && events.length === 0)}
              onClick={() =>
                submit(async () => {
                  const result = await createWebhookAction({
                    url: url.trim(),
                    description: description.trim() || undefined,
                    events: all ? ["*"] : events,
                    ...scopeParts(scope),
                  });
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  setFresh({ id: result.id, secret: result.secret });
                  setUrl("");
                  setDescription("");
                  setScope(EVERYTHING);
                  toast.success("Endpoint added");
                  router.refresh();
                })
              }
            >
              Add endpoint
            </Button>
          </FieldsetActions>
        </Fieldset>

        <Verification />
      </Panel>

      <Panel
        title="Recent deliveries"
        description="Every attempt made at every endpoint, with what came back."
        meta={`${deliveries.length} shown`}
      >
        {deliveries.length === 0 ? (
          <BlankSlate
            icon={<WebhookIcon />}
            title="Nothing sent yet"
            hint="Attempts show up here as soon as an endpoint is called."
          />
        ) : (
          <List>
            {deliveries.map((entry) => (
              <ListRow key={entry.id}>
                <StatusPill state={entry.succeeded ? "ok" : "bad"}>
                  {entry.statusCode ?? "—"}
                </StatusPill>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[12px]">{entry.event}</p>
                  {entry.error && (
                    <p className="truncate text-[11.5px] text-destructive">{entry.error}</p>
                  )}
                </div>
                <span className="hidden w-16 shrink-0 text-right text-[11.5px] text-muted-foreground sm:block">
                  {entry.attempt > 1 ? `try ${entry.attempt}` : ""}
                </span>
                <span className="w-16 shrink-0 text-right text-[11.5px] text-muted-foreground">
                  {entry.durationMs === null ? "" : `${entry.durationMs} ms`}
                </span>
                <span className="w-28 shrink-0 text-right text-[11.5px] text-muted-foreground">
                  {entry.createdAt.toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </ListRow>
            ))}
          </List>
        )}
      </Panel>
    </>
  );
}

function FreshSecret({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mb-4 rounded-xl bg-ok-soft p-3.5">
      <p className="mb-2 text-[12.5px] font-medium text-ok">
        Copy this signing secret now. It is not shown again.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-card px-2.5 py-2 font-mono text-[12px]">
          {secret}
        </code>
        <IconButton
          size="md"
          variant="outline"
          label="Copy secret"
          onClick={() => {
            navigator.clipboard.writeText(secret).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
                toast.success("Signing secret copied");
              },
              () => toast.error("Could not copy. Select it and copy it by hand."),
            );
          }}
        >
          {copied ? <Check className="text-ok" /> : <Copy />}
        </IconButton>
      </div>
    </div>
  );
}

/**
 * Anybody can post JSON at a public URL. Checking the signature is what makes
 * a webhook trustworthy, so the code for it is here rather than in a document
 * somebody has to go and find.
 */
function Verification() {
  return (
    <div className="mt-6 border-t border-border pt-5">
      <h3 className="font-display text-[15px] font-semibold tracking-[-0.01em]">
        Check the signature
      </h3>
      <Note className="mt-1">
        Every call carries <code className="font-mono">X-Mailroom-Signature</code>, which is{" "}
        <code className="font-mono">t=&lt;unix&gt;,v1=&lt;hex&gt;</code>. The signed string is the
        timestamp, a dot, then the raw body. Refuse anything older than five minutes, and compare in
        constant time.
      </Note>

      <pre className="mt-3 overflow-x-auto rounded-xl bg-muted p-3.5 font-mono text-[11.5px] leading-relaxed">
        {`import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, rawBody, header) {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=").map((s) => s.trim()))
  );
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!(age < 300)) return false;

  const expected = createHmac("sha256", secret)
    .update(\`\${parts.t}.\${rawBody}\`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}`}
      </pre>

      <Note className="mt-3">
        Answer with a 2xx as soon as you have the body. A failure is retried four times over about
        forty seconds, and an endpoint that fails twenty times in a row is switched off.
      </Note>
    </div>
  );
}
