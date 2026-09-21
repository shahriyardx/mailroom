"use client";

import {
  Badge,
  BlankSlate,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
  Switch,
} from "@/components/kit";
import type { ApiKey, Mailbox } from "@/db/schema";
import {
  PRESETS,
  SCOPE_AREAS,
  WILDCARD,
  describeAreas,
  everyScope,
  levelOf,
  scopesForLevels,
} from "@/lib/api-scopes";
import { useSubmit } from "@/lib/use-submit";
import { cn } from "@/lib/utils";
import {
  createApiKeyAction,
  deleteApiKeyAction,
  revokeApiKeyAction,
  updateApiKeyAction,
} from "@/server/actions";
import {
  ArrowUpRight,
  Ban,
  BookOpen,
  Check,
  Copy,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

const CUSTOM = "custom";

/** Where the full API reference lives, so this screen does not have to be it. */
const DOCS_URL = "https://mailroom-docs.shahriyar.dev/api/";

interface Props {
  keys: ApiKey[];
  mailboxes: Mailbox[];
  domains: { id: string; name: string }[];
  appUrl: string;
}

/**
 * What a key may reach: named addresses, whole domains, or — as null —
 * everything.
 *
 * Null rather than two empty lists, because "I am narrowing this key and have
 * not picked anything yet" and "this key reaches the whole account" are
 * opposite answers that would otherwise look identical.
 */
interface Reach {
  mailboxIds: string[];
  domainIds: string[];
}

function isEmpty(reach: Reach) {
  return reach.mailboxIds.length === 0 && reach.domainIds.length === 0;
}

/** A stored key's reach, reading the old single lock when the lists are empty. */
function reachOf(entry: ApiKey): Reach | null {
  if (entry.scopeMailboxIds.length > 0 || entry.scopeDomainIds.length > 0) {
    return { mailboxIds: entry.scopeMailboxIds, domainIds: entry.scopeDomainIds };
  }
  return entry.mailboxId ? { mailboxIds: [entry.mailboxId], domainIds: [] } : null;
}

export function ApiKeyPanel({ keys, mailboxes, domains, appUrl }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sending, submit] = useSubmit();

  const [name, setName] = useState("");
  const [reach, setReach] = useState<Reach | null>(null);
  const [preset, setPreset] = useState(PRESETS[0]!.id);
  const [chosen, setChosen] = useState<string[]>([WILDCARD]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [testKey, setTestKey] = useState(false);

  function applyPreset(id: string) {
    setPreset(id);
    if (id === CUSTOM) {
      // "*" has no rows to show, so moving to a custom choice writes out what
      // it stood for and lets it be narrowed from there.
      if (chosen.includes(WILDCARD)) setChosen(everyScope());
      return;
    }
    const found = PRESETS.find((entry) => entry.id === id);
    if (found) setChosen(found.scopes);
  }

  const active = keys.filter((item) => !item.revokedAt).length;

  return (
    <Panel
      title="Your keys"
      description="Send and read mail from your own code. A key holds a list of things it may do, and can be locked to one mailbox."
      meta={`${active} active`}
    >
      {fresh && <FreshKey token={fresh} />}

      {keys.length === 0 ? (
        <BlankSlate
          icon={<KeyRound />}
          title="No keys yet"
          hint="Make one below to reach this mailbox from a script, a server, or an agent."
        />
      ) : (
        <>
          <div className="flex items-center gap-3 border-border border-b pb-1.5 text-[11.5px] text-muted-foreground">
            <span className="min-w-0 flex-1">Key</span>
            <span className="hidden w-44 shrink-0 sm:block">Can reach</span>
            <span className="hidden w-20 shrink-0 md:block">Last used</span>
            <span className="w-8 shrink-0" />
          </div>
          <List>
            {keys.map((item) => (
              <ListRow key={item.id}>
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13px] font-medium">
                    <span className="min-w-0 truncate">{item.name}</span>
                    {item.mode === "test" && (
                      <Badge size="sm" tone="warn" title="Never reaches SES">
                        test
                      </Badge>
                    )}
                    {item.revokedAt && <StatusPill state="bad">Revoked</StatusPill>}
                  </p>
                  {/* The fragment and what the key may do read as one line:
                      three stacked lines made every row look like a form. */}
                  <p className="truncate text-[12px] text-muted-foreground">
                    <span className="font-mono">{item.prefix}</span>
                    <span className="px-1.5">·</span>
                    {describeAreas(item.scopes)}
                  </p>
                </div>

                <span className="hidden w-44 shrink-0 truncate text-[12px] text-muted-foreground sm:block">
                  {describeReach(reachOf(item), mailboxes, domains)}
                </span>
                <span className="hidden w-20 shrink-0 text-[12px] text-muted-foreground md:block">
                  {item.lastUsedAt ? item.lastUsedAt.toLocaleDateString() : "Never"}
                </span>

                {/* One menu rather than a cluster of buttons: the row is a
                    record, and three controls competing with it read as a
                    toolbar that happens to have a name attached. */}
                <span className="flex w-8 shrink-0 justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton variant="ghost" label={`Actions for ${item.name}`}>
                        <MoreHorizontal />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!item.revokedAt && (
                        <DropdownMenuItem onSelect={() => setEditing(item)}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                      )}
                      {!item.revokedAt && (
                        <DropdownMenuItem
                          onSelect={() =>
                            start(async () => {
                              await revokeApiKeyAction(item.id);
                              router.refresh();
                            })
                          }
                        >
                          <Ban />
                          Revoke
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        destructive
                        onSelect={() =>
                          start(async () => {
                            await deleteApiKeyAction(item.id);
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
        </>
      )}

      <Fieldset title="Create a key">
        <Field label="Name" htmlFor="key-name">
          <Input
            id="key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Billing service"
          />
        </Field>

        <ReachPicker
          className="mt-4"
          mailboxes={mailboxes}
          domains={domains}
          reach={reach}
          onChange={setReach}
        />

        <ScopePicker
          preset={preset}
          chosen={chosen}
          onPreset={applyPreset}
          onChange={(scopes) => {
            setPreset(CUSTOM);
            setChosen(scopes);
          }}
        />

        <div className="mt-4 flex items-start gap-3 rounded-xl border border-border p-3">
          <Switch id="key-test" checked={testKey} onCheckedChange={setTestKey} />
          <label htmlFor="key-test" className="min-w-0 flex-1 cursor-pointer">
            <span className="block text-[13px] font-medium">Test key</span>
            <span className="block text-[12px] text-muted-foreground">
              Runs every check and every webhook, and stops before SES. Nothing leaves the building,
              nothing costs anything, and nothing counts towards your sending quota. A recipient of{" "}
              <code className="font-mono">bounce@…</code> or{" "}
              <code className="font-mono">complaint@…</code> is made to look like one.
            </span>
          </label>
        </div>

        <FieldsetActions note="The key is shown once. Store it somewhere safe.">
          <Button
            variant="solid"
            pill
            loading={sending}
            disabled={
              !name.trim() || chosen.length === 0 || sending || (reach !== null && isEmpty(reach))
            }
            onClick={() =>
              submit(async () => {
                try {
                  const result = await createApiKeyAction(
                    name.trim(),
                    reach ?? undefined,
                    chosen,
                    null,
                    testKey ? "test" : "live",
                  );
                  setFresh(result.token);
                  setName("");
                  router.refresh();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not make the key");
                }
              })
            }
          >
            Create key
          </Button>
        </FieldsetActions>
      </Fieldset>

      <EditKeyDialog
        entry={editing}
        mailboxes={mailboxes}
        domains={domains}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />

      <ApiReference appUrl={appUrl} sample={mailboxes[0]?.address ?? "hello@acme.com"} />
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function FreshKey({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mb-4 rounded-xl bg-ok-soft p-3.5">
      <p className="mb-2 text-[12.5px] font-medium text-ok">
        Copy this key now. It is stored hashed and will not be shown again.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-card px-2.5 py-2 font-mono text-[12px]">
          {token}
        </code>
        <IconButton
          size="md"
          variant="outline"
          label="Copy key"
          onClick={() => {
            navigator.clipboard.writeText(token).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
                toast.success("API key copied", { description: "It will not be shown again." });
              },
              () => toast.error("Could not copy. Select the key and copy it by hand."),
            );
          }}
        >
          {copied ? <Check className="text-ok" /> : <Copy />}
        </IconButton>
      </div>
    </div>
  );
}

/** What a key may do, in as few words as the row has space for. */
function ScopeLine({ scopes }: { scopes: string[] }) {
  const summary = describeAreas(scopes);
  return (
    <p
      className={cn(
        "mt-0.5 truncate text-[11.5px]",
        summary === "No access" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {summary}
    </p>
  );
}

/**
 * What a key may reach.
 *
 * Two shapes cover what people actually mean. A whole domain is "this key
 * handles support mail", and it must include addresses made later or the key
 * quietly stops working the day somebody adds one. Named addresses are "this
 * key is for billing@", and must not grow.
 *
 * Both at once is allowed, and the common case — everything — stays one
 * click away.
 */
function ReachPicker({
  mailboxes,
  domains,
  reach,
  onChange,
  className,
}: {
  mailboxes: Mailbox[];
  domains: { id: string; name: string }[];
  reach: Reach | null;
  onChange: (next: Reach | null) => void;
  className?: string;
}) {
  const everything = reach === null;
  const current = reach ?? { mailboxIds: [], domainIds: [] };

  // Domains with no row of their own still have mailboxes, so group by the
  // name on the mailbox rather than by the domain table alone.
  const groups = domains
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      mailboxes: mailboxes.filter((box) => box.domainId === entry.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const loose = mailboxes.filter((box) => !domains.some((entry) => entry.id === box.domainId));

  function toggleDomain(domainId: string, on: boolean) {
    const covered = mailboxes.filter((box) => box.domainId === domainId).map((box) => box.id);
    onChange({
      // A whole domain already covers its addresses; keeping them named as
      // well would make the list say something the picker never showed.
      mailboxIds: on
        ? current.mailboxIds.filter((id) => !covered.includes(id))
        : current.mailboxIds,
      domainIds: on
        ? [...current.domainIds, domainId]
        : current.domainIds.filter((id) => id !== domainId),
    });
  }

  function toggleMailbox(mailboxId: string, on: boolean) {
    onChange({
      mailboxIds: on
        ? [...current.mailboxIds, mailboxId]
        : current.mailboxIds.filter((id) => id !== mailboxId),
      domainIds: current.domainIds,
    });
  }

  return (
    <div className={className}>
      <Field
        label="What this key may reach"
        htmlFor="key-reach"
        hint={
          everything
            ? "Every address on this account, including ones added later."
            : describeReach(reach, mailboxes, domains)
        }
      >
        <Select
          value={everything ? "all" : "chosen"}
          onValueChange={(value) => {
            if (!value) return;
            // Starting a narrowed key from nothing is the safe default; the
            // Create button stays disabled until something is picked.
            onChange(value === "all" ? null : { mailboxIds: [], domainIds: [] });
          }}
        >
          <SelectTrigger id="key-reach">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every mailbox</SelectItem>
            <SelectItem value="chosen">Only what I choose</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {!everything && (
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          {groups.length === 0 && loose.length === 0 ? (
            <p className="px-3.5 py-3 text-[12.5px] text-muted-foreground">
              There are no domains or addresses here yet.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {groups.map((group) => {
                const whole = current.domainIds.includes(group.id);
                return (
                  <div key={group.id}>
                    <label
                      htmlFor={`reach-domain-${group.id}`}
                      className="flex cursor-pointer items-center gap-3 bg-muted/40 px-3.5 py-2.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[12.5px] font-medium">
                          {group.name}
                        </span>
                        <span className="block text-[11.5px] text-muted-foreground">
                          {whole
                            ? "Every address on this domain, including new ones"
                            : `${group.mailboxes.length} ${
                                group.mailboxes.length === 1 ? "address" : "addresses"
                              }`}
                        </span>
                      </span>
                      <Switch
                        id={`reach-domain-${group.id}`}
                        checked={whole}
                        onCheckedChange={(on) => toggleDomain(group.id, on)}
                      />
                    </label>

                    {group.mailboxes.length > 0 && (
                      <div className={cn("divide-y divide-border", whole && "opacity-50")}>
                        {group.mailboxes.map((box) => (
                          <MailboxRow
                            key={box.id}
                            box={box}
                            checked={whole || current.mailboxIds.includes(box.id)}
                            disabled={whole}
                            onChange={(on) => toggleMailbox(box.id, on)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {loose.length > 0 && (
                <div>
                  <p className="bg-muted/40 px-3.5 py-2 text-[11.5px] text-muted-foreground">
                    Not on a domain listed here
                  </p>
                  <div className="divide-y divide-border">
                    {loose.map((box) => (
                      <MailboxRow
                        key={box.id}
                        box={box}
                        checked={current.mailboxIds.includes(box.id)}
                        disabled={false}
                        onChange={(on) => toggleMailbox(box.id, on)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MailboxRow({
  box,
  checked,
  disabled,
  onChange,
}: {
  box: Mailbox;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      htmlFor={`reach-mailbox-${box.id}`}
      className="flex cursor-pointer items-center gap-3 py-2 pr-3.5 pl-7"
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{box.address}</span>
      <Switch
        id={`reach-mailbox-${box.id}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </label>
  );
}

/** What a key reaches, said in one line. */
function describeReach(
  reach: Reach | null,
  mailboxes: Mailbox[],
  domains: { id: string; name: string }[],
) {
  if (reach === null) return "Every mailbox";

  const names = [
    ...reach.domainIds.map((id) => {
      const found = domains.find((entry) => entry.id === id);
      return found ? `all of ${found.name}` : null;
    }),
    ...reach.mailboxIds.map((id) => mailboxes.find((box) => box.id === id)?.address ?? null),
  ].filter((entry): entry is string => entry !== null);

  if (names.length === 0) return "Nothing chosen yet.";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/**
 * One decision per area rather than one per scope. Whoever is making a key
 * thinks in terms of "can it read my mail", not in terms of sixteen names.
 */
function ScopePicker({
  preset,
  chosen,
  onPreset,
  onChange,
}: {
  preset: string;
  chosen: string[];
  onPreset: (id: string) => void;
  onChange: (scopes: string[]) => void;
}) {
  const full = chosen.includes(WILDCARD);
  const note = PRESETS.find((entry) => entry.id === preset)?.hint;

  function setLevel(areaId: string, level: number) {
    const levels: Record<string, number> = {};
    for (const area of SCOPE_AREAS) {
      levels[area.id] = area.id === areaId ? level : levelOf(area, chosen);
    }
    onChange(scopesForLevels(levels));
  }

  return (
    <div className="mt-4">
      <Field label="What this key may do" htmlFor="key-preset" hint={note}>
        <Select value={preset} onValueChange={(value) => value && onPreset(value)}>
          <SelectTrigger id="key-preset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM}>Custom</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <div className="mt-3 overflow-hidden rounded-xl border border-border">
        {full ? (
          <p className="px-3.5 py-3 text-[12.5px] text-muted-foreground">
            This key can do everything, including anything added to the API later. Choose another
            option above to narrow it.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {SCOPE_AREAS.map((area) => {
              const level = levelOf(area, chosen);
              return (
                <div key={area.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium">{area.label}</span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {area.hint}
                    </span>
                  </span>
                  <Segmented
                    options={area.levels.map((entry) => entry.label)}
                    value={level}
                    onChange={(next) => setLevel(area.id, next)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** A row of choices where exactly one is on. Small, because a row holds one. */
function Segmented({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map((label, index) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(index)}
          className={cn(
            "rounded-[6px] px-2.5 py-1 text-[11.5px] transition-colors",
            index === value
              ? "bg-card font-medium text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function EditKeyDialog({
  entry,
  mailboxes,
  domains,
  onClose,
  onSaved,
}: {
  entry: ApiKey | null;
  mailboxes: Mailbox[];
  domains: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, submit] = useSubmit();
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [reach, setReach] = useState<Reach | null>(null);
  const [preset, setPreset] = useState(CUSTOM);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Fill the form the first time each key is opened, and not on every render
  // after, or typing would be undone as fast as it happened.
  if (entry && loadedFor !== entry.id) {
    setLoadedFor(entry.id);
    setName(entry.name);
    setChosen(entry.scopes);
    setReach(reachOf(entry));
    setPreset(
      PRESETS.find(
        (candidate) =>
          candidate.scopes.length === entry.scopes.length &&
          candidate.scopes.every((scope) => entry.scopes.includes(scope)),
      )?.id ?? CUSTOM,
    );
  }

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) {
          setLoadedFor(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit key</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-1">
          <Field label="Name" htmlFor="edit-key-name">
            <Input
              id="edit-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <ReachPicker
            className="mt-4"
            mailboxes={mailboxes}
            domains={domains}
            reach={reach}
            onChange={setReach}
          />

          <ScopePicker
            preset={preset}
            chosen={chosen}
            onPreset={(id) => {
              setPreset(id);
              if (id === CUSTOM) {
                if (chosen.includes(WILDCARD)) setChosen(everyScope());
                return;
              }
              const found = PRESETS.find((candidate) => candidate.id === id);
              if (found) setChosen(found.scopes);
            }}
            onChange={(scopes) => {
              setPreset(CUSTOM);
              setChosen(scopes);
            }}
          />

          <Note className="mt-3">
            The key itself does not change, so nothing that already holds it has to be updated.
          </Note>
        </div>

        <DialogFooter>
          <Button variant="ghost" pill onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="solid"
            pill
            loading={saving}
            disabled={saving || chosen.length === 0 || !entry || (reach !== null && isEmpty(reach))}
            onClick={() =>
              submit(async () => {
                if (!entry) return;
                const result = await updateApiKeyAction(entry.id, {
                  name,
                  scopes: chosen,
                  reach: reach ?? { mailboxIds: [], domainIds: [] },
                });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Key updated");
                setLoadedFor(null);
                onSaved();
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function ApiReference({ appUrl, sample }: { appUrl: string; sample: string }) {
  const origin = appUrl.replace(/\/+$/, "");
  const base = `${origin}/api/v1`;

  return (
    <div className="mt-6 border-t border-border pt-5">
      <h3 className="font-display text-[15px] font-semibold tracking-[-0.01em]">The API</h3>
      <Note className="mt-1">
        Everything below lives under <code className="font-mono">{base}</code> and takes{" "}
        <code className="font-mono">Authorization: Bearer mk_live_…</code>. Lists are paged: pass
        the <code className="font-mono">next_cursor</code> you were given back as{" "}
        <code className="font-mono">?cursor=</code>.
      </Note>

      <pre className="mt-3 overflow-x-auto rounded-xl bg-muted p-3.5 font-mono text-[11.5px] leading-relaxed">
        {`curl -X POST ${base}/emails \\
  -H "Authorization: Bearer mk_live_..." \\
  -H "Idempotency-Key: order-4821" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "${sample}",
    "to": ["someone@example.com"],
    "subject": "Hello",
    "html": "<p>Sent through SES</p>"
  }'`}
      </pre>

      <div className="mt-4 rounded-xl border border-border p-3.5">
        <p className="text-[12.5px] font-medium">Or use the Node SDK</p>
        <Note className="mt-1">
          The same API, typed, with retries, paging and webhook signature checking already done.
        </Note>
        <pre className="mt-2.5 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[11.5px] leading-relaxed">
          {`npm install @shahriyardx/mailroom

import { Mailroom } from "@shahriyardx/mailroom";

const mail = new Mailroom({
  apiKey: process.env.MAILROOM_API_KEY,
  baseUrl: "${origin}",
});

await mail.emails.send({
  from: "${sample}",
  to: "someone@example.com",
  subject: "Hello",
  html: "<p>Sent through SES</p>",
});`}
        </pre>
      </div>

      {/* The endpoint list used to be printed here in full, which made this
          screen a copy of the documentation that could fall behind it. What
          is worth having beside a key you have just made is the one request
          that proves the key works; the rest is a link. */}
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-4 flex items-center gap-2.5 rounded-xl border border-border px-3.5 py-3 transition-colors hover:bg-accent/50"
      >
        <BookOpen className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium">Every endpoint, in the docs</span>
          <span className="block text-[11.5px] text-muted-foreground">
            Sending, threads, templates, webhooks, and which scope each one needs
          </span>
        </span>
        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
      </a>
    </div>
  );
}
