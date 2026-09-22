"use client";

import {
  Badge,
  BlankSlate,
  Button,
  Input,
  List,
  ListRow,
  Note,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@/components/kit";
import {
  addForwardingAddressAction,
  addForwardingRuleAction,
  refreshForwardingAction,
  removeForwardingAddressAction,
  removeForwardingRuleAction,
  resendForwardingVerificationAction,
  setForwardOffAction,
} from "@/server/actions";
import type { ForwardingView } from "@/server/forwarding";
import { AtSign, Forward, Globe, Inbox, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Where inbound mail is also sent.
 *
 * The rules are read as each message arrives — the worker asks this app what
 * to do with it — so nothing here needs a redeploy to take effect. What does
 * need saying on screen is the part nobody can automate away: Cloudflare will
 * not forward to an address until its owner has clicked a link in an email,
 * and until then a rule pointing at it does nothing.
 */
export function ForwardingPanel({ view }: { view: ForwardingView }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [typed, setTyped] = useState("");

  const verified = view.addresses.filter((entry) => entry.verified);
  const waiting = view.addresses.filter((entry) => !entry.verified);

  function run(work: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(done);
        router.refresh();
      } else {
        toast.error(result.error ?? "That did not work");
      }
    });
  }

  return (
    <>
      <Panel
        title="Addresses"
        meta={view.addresses.length > 0 ? view.addresses.length : undefined}
        description="Somewhere a copy of inbound mail may be sent. Cloudflare emails each one a link, and forwarding to it starts working once that link is clicked."
        action={
          view.addresses.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              pill
              disabled={busy}
              onClick={() =>
                startTransition(async () => {
                  const result = await refreshForwardingAction();
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(`${result.verified} of ${result.checked} verified`);
                  router.refresh();
                })
              }
            >
              <RefreshCw />
              Check again
            </Button>
          ) : undefined
        }
      >
        {/* Inside the panel, not above it: the page is a stack of panels and
            each one owns its own spacing, so a loose banner at the top sits
            flush against the header with a divider under it. */}
        {!view.connected ? (
          <Warning>
            No Cloudflare token is connected, so no address can be verified and nothing will be
            forwarded. Connect one on <strong>Settings → Inbound worker</strong> first.
          </Warning>
        ) : null}

        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const address = typed.trim();
            if (!address) return;
            startTransition(async () => {
              const result = await addForwardingAddressAction(address);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              setTyped("");
              toast.success(
                result.verified
                  ? "Added, and Cloudflare already had it verified"
                  : "Added. Cloudflare has sent it a link to click.",
              );
              router.refresh();
            });
          }}
        >
          <Input
            type="email"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="someone@example.com"
            className="min-w-0 flex-1"
            disabled={!view.connected || busy}
          />
          <Button type="submit" disabled={!view.connected || busy || !typed.trim()}>
            Add address
          </Button>
        </form>

        {view.addresses.length === 0 ? (
          <BlankSlate
            icon={<AtSign />}
            title="Nowhere to forward to yet"
            hint="Add an address above, then say which mail should be copied to it."
          />
        ) : (
          <List>
            {view.addresses.map((entry) => (
              <ListRow key={entry.id}>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
                  <AtSign />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-mono text-[12.5px]">{entry.address}</span>
                    <Badge size="sm" tone={entry.verified ? "ok" : "warn"}>
                      {entry.verified ? "Verified" : "Waiting"}
                    </Badge>
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {entry.uses === 0
                      ? "No rule points at it yet"
                      : `Used by ${entry.uses} ${entry.uses === 1 ? "rule" : "rules"}`}
                  </div>
                </div>

                {!entry.verified ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !view.connected}
                    onClick={() =>
                      run(
                        () => resendForwardingVerificationAction(entry.id),
                        "Cloudflare has sent the link again",
                      )
                    }
                  >
                    Send again
                  </Button>
                ) : null}

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(() => removeForwardingAddressAction(entry.id), "Address removed")
                  }
                >
                  Remove
                </Button>
              </ListRow>
            ))}
          </List>
        )}

        {waiting.length > 0 ? (
          <Note className="mt-3">
            {waiting.length === 1 ? "One address is" : `${waiting.length} addresses are`} still
            waiting. Rules pointing at {waiting.length === 1 ? "it do" : "them do"} nothing until
            the link in that mail is clicked.
          </Note>
        ) : null}
      </Panel>

      <Panel
        title="Everything"
        description="A copy of every message this instance receives, whichever domain or mailbox it arrives at."
      >
        <Chips
          rules={view.instance}
          addresses={view.addresses}
          choices={verified}
          disabled={busy}
          empty="No instance-wide copy."
          onAdd={(addressId) =>
            run(
              () => addForwardingRuleAction(addressId, { kind: "instance" }),
              "Everything will be copied there",
            )
          }
          onRemove={(ruleId) => run(() => removeForwardingRuleAction(ruleId), "Rule removed")}
        />

        {view.fromEnvironment.length > 0 ? (
          <Note className="mt-3">
            <code className="font-mono">FORWARD_TO</code> in this instance's environment also copies
            everything to {view.fromEnvironment.join(", ")}. That one is set in a file, so it cannot
            be changed here and the switches below do not stop it.
          </Note>
        ) : null}
      </Panel>

      <Panel
        title="By domain"
        description="On top of anything above. A domain can also be kept out of the instance-wide copy."
      >
        {view.domains.length === 0 ? (
          <BlankSlate
            icon={<Globe />}
            title="No domains yet"
            hint="Add one on Settings → Domains."
          />
        ) : (
          <List>
            {view.domains.map((entry) => (
              <ScopeRow
                key={entry.id}
                icon={<Globe />}
                label={entry.name}
                off={entry.forwardOff}
                offLabel="Skip wider rules"
                rules={entry.rules}
                addresses={view.addresses}
                choices={verified}
                disabled={busy}
                onAdd={(addressId) =>
                  run(
                    () =>
                      addForwardingRuleAction(addressId, { kind: "domain", domainId: entry.id }),
                    `Mail to ${entry.name} will be copied there`,
                  )
                }
                onRemove={(ruleId) => run(() => removeForwardingRuleAction(ruleId), "Rule removed")}
                onToggleOff={(off) =>
                  run(
                    () => setForwardOffAction({ kind: "domain", domainId: entry.id }, off),
                    off
                      ? `${entry.name} now ignores instance-wide rules`
                      : `${entry.name} follows instance-wide rules again`,
                  )
                }
              />
            ))}
          </List>
        )}
      </Panel>

      <Panel
        title="By mailbox"
        description="The narrowest rule. Also where a single address is kept out of every wider copy."
      >
        <MailboxRules view={view} verified={verified} busy={busy} run={run} />
      </Panel>
    </>
  );
}

/* -------------------------------------------------------------------------- */

type Rule = { ruleId: string; addressId: string };

/**
 * The mailbox section, which only lists mailboxes that have something set.
 *
 * An instance with two hundred addresses would otherwise be two hundred rows
 * of nothing, so a mailbox joins the list when it is given a rule and leaves
 * when its last one goes.
 */
function MailboxRules({
  view,
  verified,
  busy,
  run,
}: {
  view: ForwardingView;
  verified: ForwardingView["addresses"];
  busy: boolean;
  run: (work: () => Promise<{ ok: boolean; error?: string }>, done: string) => void;
}) {
  const [picked, setPicked] = useState("");
  /**
   * Mailboxes pulled into the list by hand this visit.
   *
   * A mailbox earns its row by having a rule, but it cannot be given one
   * until it has a row. Holding the choice here is what breaks that circle;
   * it lasts until the page is left, by which point it either has a rule and
   * qualifies on its own, or it was a mistake and is gone.
   */
  const [opened, setOpened] = useState<string[]>([]);

  const configured = view.mailboxes.filter(
    (entry) => entry.rules.length > 0 || entry.forwardOff || opened.includes(entry.id),
  );
  const rest = view.mailboxes.filter((entry) => !configured.includes(entry));

  return (
    <>
      {configured.length === 0 ? (
        <BlankSlate
          icon={<Inbox />}
          title="No mailbox has its own rule"
          hint="Every mailbox follows the rules above. Pick one below to give it something of its own."
        />
      ) : (
        <List>
          {configured.map((entry) => (
            <ScopeRow
              key={entry.id}
              icon={<Inbox />}
              label={entry.address}
              off={entry.forwardOff}
              offLabel="Skip wider rules"
              rules={entry.rules}
              addresses={view.addresses}
              choices={verified}
              disabled={busy}
              onAdd={(addressId) =>
                run(
                  () =>
                    addForwardingRuleAction(addressId, { kind: "mailbox", mailboxId: entry.id }),
                  `Mail to ${entry.address} will be copied there`,
                )
              }
              onRemove={(ruleId) => run(() => removeForwardingRuleAction(ruleId), "Rule removed")}
              onToggleOff={(off) =>
                run(
                  () => setForwardOffAction({ kind: "mailbox", mailboxId: entry.id }, off),
                  off
                    ? `${entry.address} now ignores wider rules`
                    : `${entry.address} follows the wider rules again`,
                )
              }
            />
          ))}
        </List>
      )}

      {rest.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Select value={picked} onValueChange={(value) => value && setPicked(value)}>
            <SelectTrigger className="min-w-0 flex-1 sm:max-w-xs">
              <SelectValue placeholder="Pick a mailbox" />
            </SelectTrigger>
            <SelectContent>
              {rest.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={busy || !picked}
            onClick={() => {
              setOpened((current) => [...current, picked]);
              setPicked("");
            }}
          >
            Set up a mailbox
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** One domain or mailbox: what it copies to, and whether it opts out. */
function ScopeRow({
  icon,
  label,
  off,
  offLabel,
  rules,
  addresses,
  choices,
  disabled,
  onAdd,
  onRemove,
  onToggleOff,
}: {
  icon: React.ReactNode;
  label: string;
  off: boolean;
  offLabel: string;
  rules: Rule[];
  addresses: ForwardingView["addresses"];
  choices: ForwardingView["addresses"];
  disabled: boolean;
  onAdd: (addressId: string) => void;
  onRemove: (ruleId: string) => void;
  onToggleOff: (off: boolean) => void;
}) {
  return (
    <ListRow className="flex-wrap items-start">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12.5px]">{label}</div>
        <Chips
          className="mt-2"
          rules={rules}
          addresses={addresses}
          choices={choices}
          disabled={disabled}
          empty="Nothing of its own."
          onAdd={onAdd}
          onRemove={onRemove}
        />
      </div>

      <div className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
        <span>{offLabel}</span>
        <Switch
          checked={off}
          disabled={disabled}
          onCheckedChange={onToggleOff}
          aria-label={`${offLabel} for ${label}`}
        />
      </div>
    </ListRow>
  );
}

/** The addresses one width copies to, each removable, plus a way to add one. */
function Chips({
  rules,
  addresses,
  choices,
  disabled,
  empty,
  className,
  onAdd,
  onRemove,
}: {
  rules: Rule[];
  addresses: ForwardingView["addresses"];
  choices: ForwardingView["addresses"];
  disabled: boolean;
  empty: string;
  className?: string;
  onAdd: (addressId: string) => void;
  onRemove: (ruleId: string) => void;
}) {
  const [picked, setPicked] = useState("");
  const used = new Set(rules.map((rule) => rule.addressId));
  const free = choices.filter((entry) => !used.has(entry.id));

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        {rules.length === 0 ? (
          <span className="text-[12.5px] text-muted-foreground">{empty}</span>
        ) : (
          rules.map((rule) => {
            const address = addresses.find((entry) => entry.id === rule.addressId);
            return (
              <span
                key={rule.ruleId}
                className="pill gap-1.5 border-border bg-card font-mono text-[11.5px]"
              >
                <Forward className="size-3 shrink-0 text-muted-foreground" />
                {address?.address ?? "an address"}
                <button
                  type="button"
                  aria-label={`Stop copying to ${address?.address ?? "this address"}`}
                  disabled={disabled}
                  onClick={() => onRemove(rule.ruleId)}
                  className="-mr-0.5 text-muted-foreground transition hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })
        )}
      </div>

      {free.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select
            value={picked}
            onValueChange={(value) => {
              if (!value) return;
              setPicked("");
              onAdd(value);
            }}
          >
            <SelectTrigger className="h-8 w-full max-w-xs text-[12.5px]">
              <SelectValue placeholder="Also copy to…" />
            </SelectTrigger>
            <SelectContent>
              {free.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
      <p>{children}</p>
    </div>
  );
}
