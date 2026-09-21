"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Field,
  Fieldset,
  FieldsetActions,
  IconButton,
  List,
  ListEmpty,
  ListRow,
  Note,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/kit";
import { cn } from "@/lib/utils";
import { type GrantRow, removeGrantAction, setGrantAction, setGrantsAction } from "@/server/team";
import { ChevronDown, Globe, Mail, Plus, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

interface Props {
  grants: GrantRow[];
  teams: { id: string; name: string; isRoot: boolean }[];
  members: { id: string; name: string; email: string }[];
  domains: { id: string; name: string }[];
  mailboxes: { id: string; address: string }[];
}

export function AccessPanel({ grants, teams, members, domains, mailboxes }: Props) {
  const router = useRouter();
  const [busy, start] = useTransition();

  const [subjectType, setSubjectType] = useState<"team" | "member">("team");
  const [subjectId, setSubjectId] = useState("");
  const [resourceType, setResourceType] = useState<"domain" | "mailbox">("mailbox");
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [canCreateMailbox, setCanCreateMailbox] = useState(false);
  const [canSend, setCanSend] = useState(true);
  const [canManage, setCanManage] = useState(false);

  // The root team is not offered: it reaches everything already.
  const subjects =
    subjectType === "team"
      ? teams.filter((entry) => !entry.isRoot).map((e) => ({ id: e.id, label: e.name }))
      : members.map((e) => ({ id: e.id, label: e.name }));

  const resources =
    resourceType === "domain"
      ? domains.map((e) => ({ id: e.id, label: e.name }))
      : mailboxes.map((e) => ({ id: e.id, label: e.address }));

  // Only meaningful while exactly one resource is selected: with several,
  // there is nothing single to describe.
  const existing =
    resourceIds.length === 1
      ? grants.find(
          (grant) =>
            grant.subjectType === subjectType &&
            grant.subjectId === subjectId &&
            grant.resourceType === resourceType &&
            grant.resourceId === resourceIds[0],
        )
      : undefined;

  // Choosing a pair that already has a grant shows what it currently allows,
  // so pressing Replace cannot quietly take a right away.
  useEffect(() => {
    if (!existing) return;
    setCanSend(existing.canSend);
    setCanManage(existing.canManage);
    setCanCreateMailbox(existing.canCreateMailbox);
  }, [existing]);

  /** Writes a grant's rights. Used by the row toggles and by the form alike. */
  function write(
    grant: Omit<GrantRow, "id" | "subjectName" | "resourceName"> & {
      canCreateMailbox: boolean;
    },
    done: string,
  ) {
    start(async () => {
      const result = await setGrantAction(grant);
      if (!result.ok) {
        toast.error("That did not work");
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  return (
    <Panel
      title="Who can reach what"
      description="Give a team or one person access to a domain or a single mailbox. A grant on a domain covers every mailbox on it, including ones made later."
      meta={`${grants.length}`}
    >
      <List>
        {grants.map((grant) => (
          <ListRow key={grant.id} className="flex-wrap gap-y-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              {grant.subjectType === "team" ? (
                <Users className="size-3.5" />
              ) : (
                <Mail className="size-3.5" />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{grant.subjectName}</span>
              <span className="flex items-center gap-1.5 truncate font-mono text-[12px] text-muted-foreground">
                {grant.resourceType === "domain" && <Globe className="size-3 shrink-0" />}
                {grant.resourceName}
                {grant.resourceType === "domain" && (
                  <span className="font-sans">— whole domain</span>
                )}
              </span>
            </span>

            {/* Rights change in place. Needing to delete a grant and make it
                again to add sending was the long way round. */}
            <span className="flex shrink-0 items-center gap-1">
              <Right
                label="Read"
                on
                locked
                title="Every grant can read; remove the grant to stop that"
              />
              <Right
                label="Send as"
                on={grant.canSend}
                busy={busy}
                onClick={() =>
                  write(
                    { ...grant, canSend: !grant.canSend },
                    grant.canSend ? "Sending removed" : "Sending allowed",
                  )
                }
              />
              <Right
                label="Manage"
                on={grant.canManage}
                busy={busy}
                onClick={() =>
                  write(
                    { ...grant, canManage: !grant.canManage },
                    grant.canManage ? "Managing removed" : "Managing allowed",
                  )
                }
              />
              {grant.resourceType === "domain" && (
                <Right
                  label="Add mailboxes"
                  on={grant.canCreateMailbox}
                  busy={busy}
                  onClick={() =>
                    write(
                      { ...grant, canCreateMailbox: !grant.canCreateMailbox },
                      grant.canCreateMailbox
                        ? "They can no longer add mailboxes"
                        : "They can add mailboxes on this domain",
                    )
                  }
                />
              )}
            </span>

            <IconButton
              variant="danger"
              label={`Remove ${grant.subjectName}'s access to ${grant.resourceName}`}
              onClick={() =>
                start(async () => {
                  await removeGrantAction(grant.id);
                  toast.success("Access removed");
                  router.refresh();
                })
              }
            >
              <Trash2 />
            </IconButton>
          </ListRow>
        ))}
        {grants.length === 0 && (
          <ListEmpty>Nothing granted yet. Only the root team can reach anything.</ListEmpty>
        )}
      </List>

      <Fieldset title={existing ? "Change this access" : "Grant access"}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Give access to">
            <div className="flex gap-2">
              <Select
                value={subjectType}
                onValueChange={(value) => {
                  if (!value) return;
                  setSubjectType(value as "team" | "member");
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
              <Select value={subjectId} onValueChange={(value) => value && setSubjectId(value)}>
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.label}
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
                value={resourceType}
                onValueChange={(value) => {
                  if (!value) return;
                  setResourceType(value as "domain" | "mailbox");
                  setResourceIds([]);
                }}
              >
                <SelectTrigger className="w-36 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mailbox">One mailbox</SelectItem>
                  <SelectItem value="domain">A whole domain</SelectItem>
                </SelectContent>
              </Select>
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
                          ? (resources.find((entry) => entry.id === resourceIds[0])?.label ?? "1")
                          : `${resourceIds.length} selected`}
                    </span>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
                  <DropdownMenuLabel>
                    {resourceType === "domain" ? "Domains" : "Mailboxes"}
                  </DropdownMenuLabel>
                  {resources.map((entry) => (
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
                      <span className="truncate font-mono text-[12.5px]">{entry.label}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                  {resources.length === 0 && (
                    <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
                      Nothing to choose yet.
                    </p>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Right label="Read" on locked title="Every grant can read" />
          <Right label="Send as" on={canSend} onClick={() => setCanSend(!canSend)} />
          <Right label="Manage" on={canManage} onClick={() => setCanManage(!canManage)} />
          {/* A mailbox grant says nothing about its domain, so this only
              applies when a whole domain is being granted. */}
          {resourceType === "domain" && (
            <Right
              label="Add mailboxes"
              on={canCreateMailbox}
              onClick={() => setCanCreateMailbox(!canCreateMailbox)}
            />
          )}
        </div>

        <FieldsetActions
          note={
            existing
              ? "This pair already has a grant. Granting again replaces what it allows."
              : "Reading always comes with a grant: sending or managing something you cannot see would mean nothing."
          }
        >
          <Button
            variant="solid"
            pill
            loading={busy}
            disabled={!subjectId || resourceIds.length === 0}
            onClick={() =>
              start(async () => {
                const result = await setGrantsAction({
                  subjectType,
                  subjectId,
                  resourceType,
                  resourceIds,
                  canSend,
                  canManage,
                  canCreateMailbox,
                });
                if (!result.ok) {
                  toast.error("That did not work");
                  return;
                }
                setResourceIds([]);
                toast.success(
                  result.count === 1 ? "Access granted" : `Access granted to ${result.count}`,
                );
                router.refresh();
              })
            }
          >
            {!busy && <Plus />}
            {existing
              ? "Replace"
              : resourceIds.length > 1
                ? `Grant ${resourceIds.length}`
                : "Grant"}
          </Button>
        </FieldsetActions>
      </Fieldset>

      <Note className="mt-4">
        The root team, owners and admins reach every mailbox without a grant, so an instance can
        never be locked away from the people running it.
      </Note>
    </Panel>
  );
}

/** One right on a grant. Reading is shown but cannot be switched off. */
function Right({
  label,
  on,
  locked,
  busy,
  title,
  onClick,
}: {
  label: string;
  on: boolean;
  locked?: boolean;
  busy?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={locked || busy}
      title={title ?? (on ? `Remove ${label.toLowerCase()}` : `Allow ${label.toLowerCase()}`)}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors",
        on ? "bg-primary-soft text-primary-soft-foreground" : "bg-muted text-muted-foreground",
        locked && "opacity-60",
        !locked && "hover:bg-accent hover:text-foreground",
        !locked && on && "hover:bg-primary-soft/70 hover:text-primary-soft-foreground",
      )}
    >
      {label}
    </button>
  );
}
