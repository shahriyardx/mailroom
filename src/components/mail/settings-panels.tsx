"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Domain, Label as LabelRow, Mailbox } from "@/db/schema";
import { cn } from "@/lib/utils";
import {
  createLabelAction,
  createMailboxAction,
  createRuleAction,
  deleteLabelAction,
  deleteMailboxAction,
  deleteRuleAction,
  updateMailboxAction,
} from "@/server/actions";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Panel, StatusPill } from "./settings-ui";

const FOLDER_CHOICES: Record<string, string> = {
  archive: "Archive",
  inbox: "Inbox",
  spam: "Spam",
  trash: "Trash",
};

const PALETTE = [
  "oklch(0.56 0.115 64)",
  "oklch(0.52 0.07 240)",
  "oklch(0.52 0.09 155)",
  "oklch(0.53 0.12 20)",
  "oklch(0.5 0.09 300)",
  "oklch(0.55 0.05 250)",
];

export function MailboxPanel({
  mailboxes,
  domains,
}: {
  mailboxes: Mailbox[];
  domains: Domain[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [local, setLocal] = useState("");
  const sendable = domains.filter((item) => item.sendingEnabled && item.status === "verified");
  const [domain, setDomain] = useState(sendable[0]?.name ?? domains[0]?.name ?? "");
  const [displayName, setDisplayName] = useState("");
  const [isCatchAll, setIsCatchAll] = useState(false);
  const [color, setColor] = useState(PALETTE[0]!);

  function add() {
    start(async () => {
      try {
        await createMailboxAction({
          address: `${local.trim()}@${domain}`,
          displayName: displayName.trim() || local.trim(),
          isCatchAll,
          isDefault: mailboxes.length === 0,
          color,
        });
        setLocal("");
        setDisplayName("");
        toast.success("Mailbox added");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not add mailbox");
      }
    });
  }

  return (
    <Panel
      title="Mailboxes"
      description="One row per address you send from or receive at. No limit."
      meta={`${mailboxes.length} active`}
    >
      <div className="divide-y rounded-sm border">
        {mailboxes.map((box) => (
          <MailboxRow
            key={box.id}
            mailbox={box}
            domainReady={domains.some(
              (item) =>
                item.name === box.domain && item.sendingEnabled && item.status === "verified",
            )}
          />
        ))}
        {mailboxes.length === 0 && (
          <p className="px-3 py-6 text-center font-mono text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
            none yet
          </p>
        )}
      </div>

      <div className="mt-3 rounded-sm border bg-muted/40 p-3">
        <p className="eyebrow mb-2.5">Add mailbox</p>
        <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1">
            <Label className="eyebrow">Address</Label>
            <div className="flex items-center gap-1">
              <Input
                value={local}
                onChange={(event) => setLocal(event.target.value.replace(/[^a-z0-9._+-]/gi, ""))}
                placeholder="hello"
                className="h-8 font-mono text-[12px]"
              />
              <span className="font-mono text-[12px] text-muted-foreground">@</span>
              <Select value={domain} onValueChange={(value) => value && setDomain(value)}>
                <SelectTrigger size="sm" className="h-8 min-w-36 font-mono text-[12px]">
                  <SelectValue placeholder="domain" />
                </SelectTrigger>
                <SelectContent>
                  {domains.map((item) => (
                    <SelectItem key={item.name} value={item.name} className="font-mono text-[12px]">
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="eyebrow">Display name</Label>
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Support"
              className="h-8 text-[12.5px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="eyebrow">Colour</Label>
            <div className="flex h-8 items-center gap-1">
              {PALETTE.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setColor(item)}
                  className={cn(
                    "size-5 rounded-[3px] ring-offset-2 ring-offset-background transition",
                    color === item && "ring-2 ring-ring",
                  )}
                  style={{ background: item }}
                  aria-label={`Colour ${item}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Label className="flex items-center gap-2 text-[12px] font-normal">
            <Switch checked={isCatchAll} onCheckedChange={setIsCatchAll} className="scale-90" />
            Catch-all for this domain
          </Label>

          <Button
            size="sm"
            className="ml-auto h-8 gap-1.5 text-[12px]"
            onClick={add}
            disabled={pending || !local.trim() || !domain}
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Add mailbox
          </Button>
        </div>

        {domains.length === 0 && (
          <p className="mt-2 text-[11.5px] text-destructive">
            No verified domains returned by useSend. Check USESEND_BASE_URL and USESEND_API_KEY.
          </p>
        )}
      </div>
    </Panel>
  );
}

function MailboxRow({ mailbox, domainReady }: { mailbox: Mailbox; domainReady: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [signature, setSignature] = useState(mailbox.signature ?? "");
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: mailbox.color }} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[12.5px]">{mailbox.address}</p>
          <p className="truncate text-[11.5px] text-muted-foreground">{mailbox.displayName}</p>
        </div>

        {mailbox.isDefault && (
          <Badge variant="secondary" className="h-5 font-mono text-[9.5px] uppercase">
            default
          </Badge>
        )}
        {mailbox.isCatchAll && (
          <Badge variant="outline" className="h-5 font-mono text-[9.5px] uppercase">
            catch-all
          </Badge>
        )}

        <StatusPill state={domainReady ? "ok" : "pending"}>
          {domainReady ? "ready" : "domain pending"}
        </StatusPill>

        {!mailbox.isDefault && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11.5px] text-muted-foreground"
            onClick={() =>
              start(async () => {
                await updateMailboxAction(mailbox.id, { isDefault: true });
                router.refresh();
              })
            }
          >
            Make default
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[11.5px] text-muted-foreground"
          onClick={() => setOpen((value) => !value)}
        >
          Signature
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-sm text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${mailbox.address}`}
          onClick={() =>
            start(async () => {
              await deleteMailboxAction(mailbox.id);
              toast.success("Mailbox removed");
              router.refresh();
            })
          }
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </Button>
      </div>

      {open && (
        <div className="border-t bg-muted/40 px-3 py-2.5">
          <Textarea
            value={signature}
            onChange={(event) => setSignature(event.target.value)}
            rows={3}
            placeholder="<p>Best,<br/>Ada</p>"
            className="font-mono text-[11.5px]"
          />
          <Button
            size="sm"
            className="mt-2 h-7 text-[11.5px]"
            onClick={() =>
              start(async () => {
                await updateMailboxAction(mailbox.id, { signature });
                setOpen(false);
                toast.success("Signature saved");
                router.refresh();
              })
            }
          >
            Save signature
          </Button>
        </div>
      )}
    </div>
  );
}

export function LabelPanel({ labels }: { labels: LabelRow[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[2]!);

  return (
    <Panel
      title="Labels"
      description="Tag threads so you can find them later."
      meta={`${labels.length}`}
    >
      <ul className="flex flex-wrap gap-1.5">
        {labels.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[12px]"
          >
            <span className="size-2 rounded-[2px]" style={{ background: item.color }} />
            {item.name}
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Delete ${item.name}`}
              onClick={() =>
                start(async () => {
                  await deleteLabelAction(item.id);
                  router.refresh();
                })
              }
            >
              <Trash2 className="size-3" />
            </button>
          </li>
        ))}
        {labels.length === 0 && (
          <li className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
            none yet
          </li>
        )}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Label name"
          className="h-8 w-44 text-[12.5px]"
        />
        <div className="flex items-center gap-1">
          {PALETTE.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setColor(item)}
              className={cn(
                "size-5 rounded-[3px] ring-offset-2 ring-offset-background transition",
                color === item && "ring-2 ring-ring",
              )}
              style={{ background: item }}
              aria-label={`Colour ${item}`}
            />
          ))}
        </div>
        <Button
          size="sm"
          className="h-8 text-[12px]"
          disabled={!name.trim()}
          onClick={() =>
            start(async () => {
              await createLabelAction(name.trim(), color);
              setName("");
              router.refresh();
            })
          }
        >
          Add label
        </Button>
      </div>
    </Panel>
  );
}

export function RulePanel({
  rules,
}: {
  rules: {
    id: string;
    name: string;
    matchFrom: string | null;
    matchSubject: string | null;
    actionFolder: string | null;
  }[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [name, setName] = useState("");
  const [matchFrom, setMatchFrom] = useState("");
  const [matchSubject, setMatchSubject] = useState("");
  const [actionFolder, setActionFolder] = useState("archive");

  return (
    <Panel
      title="Filters"
      description="Applied to inbound mail before it reaches the inbox."
      meta={`${rules.length}`}
    >
      <div className="divide-y rounded-sm border">
        {rules.map((rule) => (
          <div key={rule.id} className="flex items-center gap-2.5 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium">{rule.name}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {[
                  rule.matchFrom && `from~${rule.matchFrom}`,
                  rule.matchSubject && `subject~${rule.matchSubject}`,
                ]
                  .filter(Boolean)
                  .join(" && ") || "*"}{" "}
                → {rule.actionFolder ?? "keep"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-sm text-muted-foreground hover:text-destructive"
              aria-label={`Delete ${rule.name}`}
              onClick={() =>
                start(async () => {
                  await deleteRuleAction(rule.id);
                  router.refresh();
                })
              }
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        {rules.length === 0 && (
          <p className="px-3 py-6 text-center font-mono text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
            none yet
          </p>
        )}
      </div>

      <div className="mt-3 grid gap-2.5 rounded-sm border bg-muted/40 p-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label className="eyebrow">Name</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Newsletters"
            className="h-8 text-[12.5px]"
          />
        </div>
        <div className="space-y-1">
          <Label className="eyebrow">From contains</Label>
          <Input
            value={matchFrom}
            onChange={(event) => setMatchFrom(event.target.value)}
            placeholder="@substack.com"
            className="h-8 font-mono text-[12px]"
          />
        </div>
        <div className="space-y-1">
          <Label className="eyebrow">Subject contains</Label>
          <Input
            value={matchSubject}
            onChange={(event) => setMatchSubject(event.target.value)}
            className="h-8 font-mono text-[12px]"
          />
        </div>
        <div className="space-y-1">
          <Label className="eyebrow">Move to</Label>
          <div className="flex gap-2">
            <Select value={actionFolder} onValueChange={(value) => value && setActionFolder(value)}>
              <SelectTrigger size="sm" className="h-8 flex-1 text-[12px]">
                <SelectValue>
                  {(value: string | null) => FOLDER_CHOICES[value ?? "archive"] ?? "Archive"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="archive">Archive</SelectItem>
                <SelectItem value="inbox">Inbox</SelectItem>
                <SelectItem value="spam">Spam</SelectItem>
                <SelectItem value="trash">Trash</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 text-[12px]"
              disabled={!name.trim() || (!matchFrom.trim() && !matchSubject.trim())}
              onClick={() =>
                start(async () => {
                  await createRuleAction({
                    name: name.trim(),
                    matchFrom: matchFrom.trim() || undefined,
                    matchSubject: matchSubject.trim() || undefined,
                    actionFolder: actionFolder as "inbox" | "archive" | "spam" | "trash",
                  });
                  setName("");
                  setMatchFrom("");
                  setMatchSubject("");
                  router.refresh();
                })
              }
            >
              Add
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
