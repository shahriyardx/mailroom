"use client";

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Note,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/kit";
import { EVERY_LIST, type ResourceType } from "@/lib/access-scopes";
import { cn } from "@/lib/utils";
import { type GrantRow, removeGrantAction, setGrantAction, setGrantsAction } from "@/server/team";
import { ChevronDown, Globe, Inbox, ListChecks, Mail, Plus, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Who can reach what.
 *
 * Two questions, kept apart, because they are not the same question. On the
 * mail side it is whose correspondence somebody may read. On the campaigns
 * side it is which audience somebody may write to — a list of real people who
 * agreed to hear from you, which is the most sensitive thing in the product
 * and, until now, had no access control at all.
 *
 * The grants are grouped under the person or team they are about rather than
 * listed flat: the question anybody actually arrives with is "what can Ada
 * reach", and a flat list makes that a search.
 */

interface Named {
  id: string;
  name: string;
}

interface Props {
  mailGrants: GrantRow[];
  campaignGrants: GrantRow[];
  teams: { id: string; name: string; isRoot: boolean }[];
  members: { id: string; name: string; email: string }[];
  domains: Named[];
  mailboxes: { id: string; address: string }[];
  lists: Named[];
  /** Which halves of the product are on. A half that is off has no tab. */
  features: { inbox: boolean; campaigns: boolean };
}

/** What a right means, stated for the side it is on. */
interface RightWords {
  key: "canSend" | "canManage" | "canCreateMailbox";
  label: string;
  detail: string;
  /** Only offered on the resource that can carry it. */
  onlyOn?: ResourceType;
}

const MAIL_RIGHTS: RightWords[] = [
  { key: "canSend", label: "Send as it", detail: "Write and reply from this address." },
  {
    key: "canManage",
    label: "Change its settings",
    detail: "Its name, colour and signature.",
  },
  {
    key: "canCreateMailbox",
    label: "Add mailboxes to it",
    detail: "New addresses on this domain, reachable by the same grant.",
    onlyOn: "domain",
  },
];

const CAMPAIGN_RIGHTS: RightWords[] = [
  {
    key: "canSend",
    label: "Send to it",
    detail: "Aim a campaign or an automation at these people.",
  },
  {
    key: "canManage",
    label: "Manage it",
    detail: "Edit the list, add and remove people, and export it.",
  },
];

export function AccessPanel(props: Props) {
  const { features } = props;
  const both = features.inbox && features.campaigns;
  const [side, setSide] = useState(features.inbox ? "mail" : "campaigns");

  const mail = (
    <GrantSection
      kind="mail"
      grants={props.mailGrants}
      teams={props.teams}
      members={props.members}
      scopes={[
        { type: "mailbox", label: "One mailbox", options: props.mailboxes.map(asNamed) },
        { type: "domain", label: "A whole domain", options: props.domains },
      ]}
      rights={MAIL_RIGHTS}
      empty="Nothing granted yet. Only the owner and the root team can reach a mailbox."
      note="The owner and the root team reach every mailbox without a grant, so an instance can never be locked away from the person who runs it. An admin runs the place but reads only the mail they are given, like anybody else."
    />
  );

  const campaigns = (
    <GrantSection
      kind="campaigns"
      grants={props.campaignGrants}
      teams={props.teams}
      members={props.members}
      scopes={[
        { type: "list", label: "One list", options: props.lists },
        {
          type: "lists",
          label: "Every list",
          options: [{ id: EVERY_LIST, name: "Every list, now and later" }],
        },
      ]}
      rights={CAMPAIGN_RIGHTS}
      empty="Nothing granted yet. Only an owner or an admin can reach a list."
      note="An owner or an admin reaches every list without a grant. A grant is how somebody who is neither — the person who writes the newsletter, the team that runs one campaign — gets at an audience without being given the instance. Managing every list is also the right to make a new one."
    />
  );

  if (!both) return features.inbox ? mail : campaigns;

  return (
    <Tabs value={side} onValueChange={setSide}>
      <TabsList className="mb-4">
        <TabsTrigger value="mail">
          <Inbox className="size-3.5" />
          Mail
        </TabsTrigger>
        <TabsTrigger value="campaigns">
          <ListChecks className="size-3.5" />
          Campaigns
        </TabsTrigger>
      </TabsList>
      <TabsContent value="mail">{mail}</TabsContent>
      <TabsContent value="campaigns">{campaigns}</TabsContent>
    </Tabs>
  );
}

function asNamed(box: { id: string; address: string }): Named {
  return { id: box.id, name: box.address };
}

interface Scope {
  type: ResourceType;
  label: string;
  options: Named[];
}

/* -------------------------------------------------------------------------- */

function GrantSection({
  kind,
  grants,
  teams,
  members,
  scopes,
  rights,
  empty,
  note,
}: {
  kind: "mail" | "campaigns";
  grants: GrantRow[];
  teams: { id: string; name: string; isRoot: boolean }[];
  members: { id: string; name: string; email: string }[];
  scopes: Scope[];
  rights: RightWords[];
  empty: string;
  note: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [granting, setGranting] = useState(false);

  /*
   * One card per subject.
   *
   * Access is read as a question about a person or a team, never about a
   * mailbox, so the rows are gathered under whoever they are about. Two
   * grants for Ada are one card with two lines, not two rows a page apart.
   */
  const bySubject = useMemo(() => {
    const groups = new Map<string, { grant: GrantRow; rows: GrantRow[] }>();
    for (const grant of grants) {
      const key = `${grant.subjectType}:${grant.subjectId}`;
      const found = groups.get(key);
      if (found) found.rows.push(grant);
      else groups.set(key, { grant, rows: [grant] });
    }
    return [...groups.values()].sort((a, b) =>
      a.grant.subjectName.localeCompare(b.grant.subjectName),
    );
  }, [grants]);

  function change(grant: GrantRow, next: Rights) {
    start(async () => {
      const result = await setGrantAction({ ...grant, ...next });
      if (!result.ok) {
        toast.error("That did not work");
        return;
      }
      toast.success("Access changed");
      router.refresh();
    });
  }

  return (
    <Panel
      title={kind === "mail" ? "Mail" : "Campaigns"}
      description={
        kind === "mail"
          ? "Who may read, send as and change a mailbox. A grant on a domain covers every mailbox on it, including ones made later."
          : "Who may see, write to and manage a mailing list. A grant on every list covers the ones made later too."
      }
      meta={`${grants.length}`}
      action={
        <Button variant="solid" size="md" onClick={() => setGranting(true)}>
          <Plus />
          Grant access
        </Button>
      }
    >
      {bySubject.length === 0 ? (
        <div className="rounded-xl border border-border border-dashed px-4 py-8 text-center">
          <p className="text-[13px] text-muted-foreground">{empty}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {bySubject.map(({ grant, rows }) => (
            <div
              key={`${grant.subjectType}:${grant.subjectId}`}
              className="rounded-xl border border-border bg-card"
            >
              <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  {grant.subjectType === "team" ? (
                    <Users className="size-3.5" />
                  ) : (
                    <Mail className="size-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[13.5px]">
                    {grant.subjectName}
                  </span>
                  {grant.subjectEmail && (
                    <span className="block truncate font-mono text-[11.5px] text-muted-foreground">
                      {grant.subjectEmail}
                    </span>
                  )}
                </span>
                <Badge size="sm" tone="neutral">
                  {grant.subjectType === "team" ? "Team" : "Person"}
                </Badge>
              </div>

              <ul>
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5 not-last:border-b not-last:border-border"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {row.resourceType === "domain" || row.resourceType === "lists" ? (
                          <Globe className="size-3 shrink-0 text-muted-foreground" />
                        ) : null}
                        <span className="truncate font-mono text-[12.5px]">{row.resourceName}</span>
                      </span>
                      <span className="block text-[12px] text-muted-foreground leading-relaxed">
                        {describe(row)}
                      </span>
                    </span>

                    <RightsMenu
                      busy={busy}
                      rights={rights}
                      resourceType={row.resourceType}
                      value={row}
                      onChange={(next) => change(row, next)}
                    />

                    <IconButton
                      variant="danger"
                      label={`Remove this access to ${row.resourceName}`}
                      onClick={() =>
                        start(async () => {
                          await removeGrantAction(row.id);
                          toast.success("Access removed");
                          router.refresh();
                        })
                      }
                    >
                      <Trash2 />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Note className="mt-4">{note}</Note>

      <GrantDialog
        open={granting}
        onOpenChange={setGranting}
        kind={kind}
        teams={teams}
        members={members}
        scopes={scopes}
        rights={rights}
        grants={grants}
      />
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

interface Rights {
  canSend: boolean;
  canManage: boolean;
  canCreateMailbox: boolean;
}

/**
 * Granting, in a dialog.
 *
 * It used to be four dropdowns in a row under the list, which on a narrow
 * window wrapped into a shape nobody could read as one sentence. A dialog has
 * the width to ask the three questions one under another, and to say what
 * each right means rather than leaving somebody to guess from two words.
 */
function GrantDialog({
  open,
  onOpenChange,
  kind,
  teams,
  members,
  scopes,
  rights,
  grants,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "mail" | "campaigns";
  teams: { id: string; name: string; isRoot: boolean }[];
  members: { id: string; name: string; email: string }[];
  scopes: Scope[];
  rights: RightWords[];
  grants: GrantRow[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();

  const [subjectType, setSubjectType] = useState<"team" | "member">("team");
  const [subjectId, setSubjectId] = useState("");
  const [scopeType, setScopeType] = useState<ResourceType>(scopes[0].type);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [value, setValue] = useState<Rights>({
    canSend: true,
    canManage: false,
    canCreateMailbox: false,
  });

  const scope = scopes.find((entry) => entry.type === scopeType) ?? scopes[0];
  const wildcard = scope.options.length === 1 && scope.options[0].id === EVERY_LIST;

  // The root team is not offered: it reaches everything already.
  const subjects: { id: string; label: string; hint?: string }[] =
    subjectType === "team"
      ? teams.filter((entry) => !entry.isRoot).map((e) => ({ id: e.id, label: e.name }))
      : members.map((e) => ({ id: e.id, label: e.name, hint: e.email }));

  const chosen = wildcard ? [EVERY_LIST] : resourceIds;

  // Granting again to a pair that already has one replaces what it allows, so
  // the dialog says so rather than letting somebody take a right away by
  // accident.
  const replacing =
    chosen.length === 1 &&
    grants.some(
      (grant) =>
        grant.subjectType === subjectType &&
        grant.subjectId === subjectId &&
        grant.resourceType === scopeType &&
        grant.resourceId === chosen[0],
    );

  function close() {
    onOpenChange(false);
    setResourceIds([]);
    setSubjectId("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Grant access</DialogTitle>
          <DialogDescription>
            {kind === "mail"
              ? "Reading comes with every grant: sending or changing something you cannot see would mean nothing."
              : "Seeing the list comes with every grant. Everything else is added on top of it."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Give access to">
            <div className="flex gap-2">
              <Select
                value={subjectType}
                onValueChange={(next) => {
                  if (!next) return;
                  setSubjectType(next as "team" | "member");
                  setSubjectId("");
                }}
              >
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">A team</SelectItem>
                  <SelectItem value="member">One person</SelectItem>
                </SelectContent>
              </Select>
              <Select value={subjectId} onValueChange={(next) => next && setSubjectId(next)}>
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{entry.label}</span>
                        {entry.hint && (
                          <span className="truncate font-mono text-[11px] text-muted-foreground">
                            {entry.hint}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                  {subjects.length === 0 && (
                    <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
                      {subjectType === "team" ? "No teams besides root yet." : "Nobody yet."}
                    </p>
                  )}
                </SelectContent>
              </Select>
            </div>
          </Field>

          <Field label="To">
            <div className="flex gap-2">
              <Select
                value={scopeType}
                onValueChange={(next) => {
                  if (!next) return;
                  setScopeType(next as ResourceType);
                  setResourceIds([]);
                }}
              >
                <SelectTrigger className="w-36 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scopes.map((entry) => (
                    <SelectItem key={entry.type} value={entry.type}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* A scope that names one thing has nothing to pick. */}
              {wildcard ? (
                <p className="flex h-9 min-w-0 flex-1 items-center rounded-[10px] bg-muted px-3 text-[12.5px] text-muted-foreground">
                  {scope.options[0].name}
                </p>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded-[10px] border border-transparent bg-muted px-3 text-left text-[13.5px] transition-colors hover:bg-accent"
                    >
                      <span className="truncate font-mono text-[12.5px]">
                        {resourceIds.length === 0
                          ? "Choose"
                          : resourceIds.length === 1
                            ? (scope.options.find((entry) => entry.id === resourceIds[0])?.name ??
                              "1")
                            : `${resourceIds.length} selected`}
                      </span>
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
                    <DropdownMenuLabel>{scope.label}</DropdownMenuLabel>
                    {scope.options.map((entry) => (
                      <DropdownMenuCheckboxItem
                        key={entry.id}
                        checked={resourceIds.includes(entry.id)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(next) =>
                          setResourceIds((current) =>
                            next === true
                              ? [...current, entry.id]
                              : current.filter((id) => id !== entry.id),
                          )
                        }
                      >
                        <span className="truncate font-mono text-[12.5px]">{entry.name}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                    {scope.options.length === 0 && (
                      <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
                        Nothing to choose yet.
                      </p>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </Field>

          {/* Said in full rather than as a row of two-word switches: these are
              the words somebody is deciding by. */}
          <Field label="They may">
            <div className="space-y-1">
              <p className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground">
                <Checkbox checked disabled className="mt-0.5" />
                <span>
                  <span className="block text-foreground">
                    {kind === "mail" ? "Read it" : "See it"}
                  </span>
                  <span className="block text-[12px]">
                    Always. A grant that allows nothing is no grant.
                  </span>
                </span>
              </p>

              {rights
                .filter((right) => !right.onlyOn || right.onlyOn === scopeType)
                .map((right) => (
                  // A button rather than a label around the box: the whole
                  // row is the target, and the explanation under each right is
                  // part of what somebody is clicking.
                  <button
                    key={right.key}
                    type="button"
                    aria-pressed={value[right.key]}
                    onClick={() =>
                      setValue((current) => ({ ...current, [right.key]: !current[right.key] }))
                    }
                    className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
                  >
                    <Checkbox
                      checked={value[right.key]}
                      tabIndex={-1}
                      className="pointer-events-none mt-0.5"
                    />
                    <span>
                      <span className="block">{right.label}</span>
                      <span className="block text-[12px] text-muted-foreground">
                        {right.detail}
                      </span>
                    </span>
                  </button>
                ))}
            </div>
          </Field>
        </div>

        <DialogFooter>
          {replacing && (
            <p className="mr-auto text-[12px] text-muted-foreground">
              This pair already has a grant. Granting replaces what it allows.
            </p>
          )}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="solid"
            loading={busy}
            disabled={!subjectId || chosen.length === 0}
            onClick={() =>
              start(async () => {
                const result = await setGrantsAction({
                  subjectType,
                  subjectId,
                  resourceType: scopeType,
                  resourceIds: chosen,
                  canSend: value.canSend,
                  canManage: value.canManage,
                  canCreateMailbox: value.canCreateMailbox,
                });
                if (!result.ok) {
                  toast.error("That did not work");
                  return;
                }
                toast.success(
                  result.count === 1 ? "Access granted" : `Access granted to ${result.count}`,
                );
                close();
                router.refresh();
              })
            }
          >
            {replacing ? "Replace" : chosen.length > 1 ? `Grant ${chosen.length}` : "Grant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/** The grant in a sentence, so a row does not have to be decoded. */
function describe(grant: GrantRow) {
  const campaigns = grant.resourceType === "list" || grant.resourceType === "lists";

  const doing = [campaigns ? "see" : "read"];
  if (grant.canSend) doing.push(campaigns ? "send to" : "send as");
  if (grant.canManage) doing.push(campaigns ? "manage" : "change the settings of");

  const list =
    doing.length === 1 ? doing[0] : `${doing.slice(0, -1).join(", ")} and ${doing.at(-1)}`;

  const what =
    grant.resourceType === "domain"
      ? "every mailbox on it"
      : grant.resourceType === "lists"
        ? "every list"
        : "it";

  const adding =
    grant.resourceType === "domain" && grant.canCreateMailbox
      ? ", and may add new mailboxes"
      : grant.resourceType === "lists" && grant.canManage
        ? ", and may make new ones"
        : "";

  return `Can ${list} ${what}${adding}.`;
}

/** The rights on one grant, as one control. */
function RightsMenu({
  value,
  onChange,
  rights,
  resourceType,
  busy,
}: {
  value: Rights;
  onChange: (next: Rights) => void;
  rights: RightWords[];
  resourceType: ResourceType;
  busy?: boolean;
}) {
  const offered = rights.filter((right) => !right.onlyOn || right.onlyOn === resourceType);
  const extra = offered.filter((right) => value[right.key]).length;
  const base = resourceType === "list" || resourceType === "lists" ? "See" : "Read";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className={cn(
            "flex w-24 shrink-0 items-center justify-between gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12px] text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-foreground disabled:opacity-50",
          )}
        >
          <span className="truncate">{extra === 0 ? base : `${base}, +${extra}`}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>They may</DropdownMenuLabel>

        <DropdownMenuCheckboxItem checked disabled onSelect={(event) => event.preventDefault()}>
          {base}
        </DropdownMenuCheckboxItem>

        {offered.map((right) => (
          <DropdownMenuCheckboxItem
            key={right.key}
            checked={value[right.key]}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(next) => onChange({ ...value, [right.key]: next === true })}
          >
            {right.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
