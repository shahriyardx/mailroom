"use client";

import {
  Badge,
  Button,
  ColorPicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Fieldset,
  IconButton,
  Input,
  List,
  ListEmpty,
  ListRow,
  Note,
  PALETTE,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
  Switch,
  Textarea,
} from "@/components/kit";
import type { Domain, Label as LabelRow, Mailbox } from "@/db/schema";
import {
  createLabelAction,
  createMailboxAction,
  createRuleAction,
  deleteLabelAction,
  deleteMailboxAction,
  deleteRuleAction,
  updateMailboxAction,
} from "@/server/actions";
import { MoreHorizontal, PenLine, Plus, Star, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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
  const [color, setColor] = useState<string>(PALETTE[0]);

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
      description="One row per address you send from or receive at. There is no limit."
      meta={`${mailboxes.length} active`}
    >
      <List>
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
        {mailboxes.length === 0 && <ListEmpty>No mailboxes yet.</ListEmpty>}
      </List>

      <Fieldset title="Add a mailbox">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address" htmlFor="mailbox-local">
            <div className="flex items-center gap-1.5">
              <Input
                id="mailbox-local"
                mono
                value={local}
                onChange={(event) => setLocal(event.target.value.replace(/[^a-z0-9._+-]/gi, ""))}
                placeholder="hello"
              />
              <span className="font-mono text-[13px] text-muted-foreground">@</span>
              <Select value={domain} onValueChange={(value) => value && setDomain(value)}>
                <SelectTrigger className="min-w-40 font-mono text-[12.5px]">
                  <SelectValue placeholder="domain" />
                </SelectTrigger>
                <SelectContent>
                  {domains.map((item) => (
                    <SelectItem key={item.name} value={item.name} className="font-mono">
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Field>

          <Field
            label="Display name"
            htmlFor="mailbox-name"
            hint="What recipients see as the sender."
          >
            <Input
              id="mailbox-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Support"
            />
          </Field>

          <Field label="Colour" hint="Marks this mailbox everywhere else in the app.">
            <ColorPicker value={color} onChange={setColor} palette={PALETTE} />
          </Field>

          <Field
            label="Catch-all"
            hint="Take every address on this domain that no other mailbox claims."
          >
            <div className="flex h-9 items-center gap-2.5">
              <Switch id="mailbox-catch-all" checked={isCatchAll} onCheckedChange={setIsCatchAll} />
              <label htmlFor="mailbox-catch-all" className="text-[13px] text-muted-foreground">
                Catch everything on {domain || "this domain"}
              </label>
            </div>
          </Field>
        </div>

        <div className="mt-4 flex items-center gap-3">
          {domains.length === 0 && (
            <Note className="text-destructive">
              No verified domains yet. Add one under Domains first.
            </Note>
          )}
          <Button
            variant="solid"
            pill
            className="ml-auto"
            onClick={add}
            loading={pending}
            disabled={!local.trim() || !domain}
          >
            {!pending && <Plus />}
            Add mailbox
          </Button>
        </div>
      </Fieldset>
    </Panel>
  );
}

function MailboxRow({ mailbox, domainReady }: { mailbox: Mailbox; domainReady: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [signature, setSignature] = useState(mailbox.signature ?? "");
  const [open, setOpen] = useState(false);

  return (
    <div>
      <ListRow>
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: mailbox.color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[13px]">{mailbox.address}</p>
          <p className="truncate text-[12px] text-muted-foreground">{mailbox.displayName}</p>
        </div>

        {mailbox.isDefault && <Badge size="sm">Default</Badge>}
        {mailbox.isCatchAll && (
          <Badge size="sm" tone="outline">
            Catch-all
          </Badge>
        )}
        <StatusPill state={domainReady ? "ok" : "pending"}>
          {domainReady ? "Ready" : "Domain pending"}
        </StatusPill>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`Actions for ${mailbox.address}`}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => setOpen((value) => !value)}>
              <PenLine /> {open ? "Hide signature" : "Edit signature"}
            </DropdownMenuItem>
            {!mailbox.isDefault && (
              <DropdownMenuItem
                onSelect={() =>
                  start(async () => {
                    await updateMailboxAction(mailbox.id, { isDefault: true });
                    toast.success("Default mailbox changed");
                    router.refresh();
                  })
                }
              >
                <Star /> Make default
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onSelect={() =>
                start(async () => {
                  await deleteMailboxAction(mailbox.id);
                  toast.success("Mailbox removed");
                  router.refresh();
                })
              }
            >
              <Trash2 /> Delete mailbox
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ListRow>

      {open && (
        <div className="border-t border-border bg-muted/40 px-3.5 py-3">
          <Field
            label="Signature"
            htmlFor={`signature-${mailbox.id}`}
            hint="Appended to every message sent from this address. HTML is allowed."
          >
            <Textarea
              id={`signature-${mailbox.id}`}
              mono
              rows={3}
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
              placeholder="<p>Best,<br/>Ada</p>"
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button
              variant="solid"
              size="sm"
              pill
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
            <Button variant="ghost" size="sm" pill onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function LabelPanel({ labels }: { labels: LabelRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PALETTE[2]);

  return (
    <Panel
      title="Labels"
      description="Tag conversations so you can find them again."
      meta={`${labels.length}`}
    >
      {labels.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {labels.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-1.5 rounded-full bg-muted py-1 pr-1.5 pl-2.5 text-[12.5px]"
            >
              <span
                className="size-2 rounded-full"
                style={{ background: item.color }}
                aria-hidden
              />
              {item.name}
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-destructive"
                aria-label={`Delete ${item.name}`}
                onClick={() =>
                  start(async () => {
                    await deleteLabelAction(item.id);
                    router.refresh();
                  })
                }
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Note>No labels yet.</Note>
      )}

      <Fieldset title="Add a label">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Name" htmlFor="label-name" className="w-52">
            <Input
              id="label-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Newsletters"
            />
          </Field>
          <Field label="Colour">
            <ColorPicker value={color} onChange={setColor} palette={PALETTE} />
          </Field>
          <Button
            variant="solid"
            pill
            className="ml-auto"
            loading={pending}
            disabled={!name.trim()}
            onClick={() =>
              start(async () => {
                await createLabelAction(name.trim(), color);
                setName("");
                router.refresh();
              })
            }
          >
            {!pending && <Plus />}
            Add label
          </Button>
        </div>
      </Fieldset>
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
  const [pending, start] = useTransition();
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
      <List>
        {rules.map((rule) => (
          <ListRow key={rule.id}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{rule.name}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {[
                  rule.matchFrom && `From contains ${rule.matchFrom}`,
                  rule.matchSubject && `subject contains ${rule.matchSubject}`,
                ]
                  .filter(Boolean)
                  .join(", and ") || "Everything"}{" "}
                &rarr; {rule.actionFolder ?? "keep in inbox"}
              </p>
            </div>
            <IconButton
              variant="danger"
              label={`Delete ${rule.name}`}
              onClick={() =>
                start(async () => {
                  await deleteRuleAction(rule.id);
                  router.refresh();
                })
              }
            >
              <Trash2 />
            </IconButton>
          </ListRow>
        ))}
        {rules.length === 0 && <ListEmpty>No filters yet.</ListEmpty>}
      </List>

      <Fieldset title="Add a filter">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="rule-name">
            <Input
              id="rule-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Newsletters"
            />
          </Field>
          <Field label="Move to" htmlFor="rule-folder">
            <Select value={actionFolder} onValueChange={(value) => value && setActionFolder(value)}>
              <SelectTrigger id="rule-folder">
                <SelectValue placeholder="Archive" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="archive">Archive</SelectItem>
                <SelectItem value="inbox">Inbox</SelectItem>
                <SelectItem value="spam">Spam</SelectItem>
                <SelectItem value="trash">Trash</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="From contains" htmlFor="rule-from">
            <Input
              id="rule-from"
              mono
              value={matchFrom}
              onChange={(event) => setMatchFrom(event.target.value)}
              placeholder="@substack.com"
            />
          </Field>
          <Field label="Subject contains" htmlFor="rule-subject">
            <Input
              id="rule-subject"
              mono
              value={matchSubject}
              onChange={(event) => setMatchSubject(event.target.value)}
              placeholder="invoice"
            />
          </Field>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Note>A filter needs at least one thing to match on.</Note>
          <Button
            variant="solid"
            pill
            className="ml-auto"
            loading={pending}
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
            {!pending && <Plus />}
            Add filter
          </Button>
        </div>
      </Fieldset>
    </Panel>
  );
}
