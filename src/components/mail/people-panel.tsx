"use client";

import {
  Avatar,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Field,
  Fieldset,
  FieldsetActions,
  IconButton,
  Input,
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
  StatusPill,
} from "@/components/kit";
import { useSubmit } from "@/lib/use-submit";
import { cn } from "@/lib/utils";
import type { Role } from "@/server/access";
import {
  type PersonRow,
  cancelInvitationAction,
  createTeamAction,
  deleteTeamAction,
  inviteMemberAction,
  removeMemberAction,
  renameTeamAction,
  resendInvitationAction,
  setMemberRoleAction,
  setTeamMembershipAction,
  setTeamRoleAction,
} from "@/server/team";
import { ChevronDown, PenLine, Plus, RotateCw, Trash2, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface TeamRow {
  id: string;
  name: string;
  isRoot: boolean;
}

interface Props {
  people: PersonRow[];
  pending: { id: string; email: string; role: string | null; teamId: string | null }[];
  teams: TeamRow[];
  /** Addresses an invitation may be sent from. Empty means there are none. */
  senders?: { id: string; address: string; isDefault: boolean }[];
  me: { userId: string; role: Role };
  /** True for an administrator: roles, invitations, removing people. */
  canManage: boolean;
  /** Teams this person leads, whose membership they may change. */
  leadsTeamIds?: string[];
}

export function PeoplePanel({
  people,
  pending,
  teams,
  senders = [],
  me,
  canManage,
  leadsTeamIds = [],
}: Props) {
  // A lead may put people in and out of their own team, and nothing else.
  const mayChangeTeam = (teamId: string) => canManage || leadsTeamIds.includes(teamId);
  const router = useRouter();
  const [busy, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [teamId, setTeamId] = useState<string>(teams.find((t) => !t.isRoot)?.id ?? "");
  const [teamName, setTeamName] = useState("");
  // Which team is being renamed, and what it is being renamed to.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [fromId, setFromId] = useState<string>(
    () => (senders.find((box) => box.isDefault) ?? senders[0])?.id ?? "",
  );
  // Teams start shut, so the page opens as a list of teams rather than a
  // wall of everyone in them.
  const [opened, setOpened] = useState<string[]>([]);

  // The forms that clear themselves do not go through a transition; see
  // useSubmit for why.
  const [sending, submit] = useSubmit();

  type Result = { ok: boolean; error?: string } | undefined;

  function run(action: () => Promise<Result>, done?: string) {
    start(async () => {
      const result = await action();
      if (result && !result.ok) {
        toast.error(result.error ?? "That did not work");
        return;
      }
      if (done) toast.success(done);
      router.refresh();
    });
  }

  return (
    <>
      <Panel
        title="People"
        description="Everyone who can sign in to this instance, and what each of them may do."
        meta={`${people.length}`}
      >
        <div className="flex items-center gap-3 border-border border-b pb-1.5 text-[11.5px] text-muted-foreground">
          <span className="min-w-0 flex-1">Person</span>
          <span className="w-28 shrink-0">Teams</span>
          <span className="w-28 shrink-0">Across the instance</span>
          <span className="w-8 shrink-0" />
        </div>
        <List>
          {people.map((person) => (
            <ListRow key={person.memberId}>
              <Avatar size="sm" name={person.name} address={person.email} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">
                  {person.name}
                  {person.userId === me.userId && (
                    <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">
                      you
                    </span>
                  )}
                </span>
                <span className="block truncate font-mono text-[12px] text-muted-foreground">
                  {person.email}
                </span>
              </span>

              {/* Membership is changed on the teams below, so here it only
                  says where this person belongs. */}
              <span className="flex w-28 shrink-0 flex-wrap gap-1">
                {person.teams.length === 0 ? (
                  <span className="text-[12px] text-muted-foreground">No team</span>
                ) : (
                  person.teams.map((entry) => (
                    <Badge
                      key={entry.id}
                      size="sm"
                      tone={entry.isRoot ? "accent" : "neutral"}
                      title={entry.lead ? `Leads ${entry.name}` : `In ${entry.name}`}
                    >
                      {entry.name}
                      {entry.lead && " ★"}
                    </Badge>
                  ))
                )}
              </span>

              {/* An owner's role is editable only by another owner, and
                  nobody edits their own: that is how an instance ends up with
                  nobody able to run it. */}
              {canManage &&
              person.userId !== me.userId &&
              (person.role !== "owner" || me.role === "owner") ? (
                <Select
                  value={person.role}
                  onValueChange={(value) =>
                    value &&
                    run(() => setMemberRoleAction(person.memberId, value as Role), "Role changed")
                  }
                >
                  <SelectTrigger size="sm" className="w-28 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {me.role === "owner" && <SelectItem value="owner">Owner</SelectItem>}
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="flex w-28 shrink-0 justify-start">
                  <StatusPill state={person.role === "owner" ? "ok" : "pending"}>
                    {person.role}
                  </StatusPill>
                </span>
              )}

              {/* The slot is always here. Without it a row that cannot be
                  removed is narrower, and its columns sit off to the right of
                  every other row. */}
              <span className="flex w-8 shrink-0 justify-end">
                {canManage && person.role !== "owner" && person.userId !== me.userId && (
                  <IconButton
                    variant="danger"
                    label={`Remove ${person.email}`}
                    onClick={() => run(() => removeMemberAction(person.memberId), "Removed")}
                  >
                    <Trash2 />
                  </IconButton>
                )}
              </span>
            </ListRow>
          ))}
        </List>

        {pending.length > 0 && (
          <>
            <p className="mt-5 mb-2 text-[12.5px] font-semibold">Invited, not yet signed in</p>
            <List>
              {pending.map((entry) => (
                <ListRow key={entry.id}>
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                    {entry.email}
                  </span>
                  <Badge size="sm">{entry.role ?? "member"}</Badge>
                  {canManage && (
                    <IconButton
                      label={`Send ${entry.email} a new link`}
                      onClick={() =>
                        start(async () => {
                          const result = await resendInvitationAction(entry.id);
                          if (!result.ok) {
                            toast.error(result.error);
                            return;
                          }
                          await navigator.clipboard.writeText(result.link).catch(() => {});
                          toast.success(result.sent ? "Invitation sent again" : "New link copied", {
                            description: result.sent
                              ? `Emailed to ${entry.email}. The link is on your clipboard too.`
                              : `It could not be emailed: ${result.reason}`,
                          });
                          router.refresh();
                        })
                      }
                    >
                      <RotateCw />
                    </IconButton>
                  )}
                  {canManage && (
                    <IconButton
                      variant="danger"
                      label={`Cancel the invitation for ${entry.email}`}
                      onClick={() =>
                        run(async () => {
                          await cancelInvitationAction(entry.id);
                          return undefined;
                        }, "Invitation cancelled")
                      }
                    >
                      <Trash2 />
                    </IconButton>
                  )}
                </ListRow>
              ))}
            </List>
          </>
        )}

        {canManage && (
          <Fieldset title="Invite someone">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Email" htmlFor="invite-email">
                <Input
                  id="invite-email"
                  mono
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="person@company.com"
                />
              </Field>
              <Field label="Role" htmlFor="invite-role">
                <Select value={role} onValueChange={(value) => value && setRole(value as Role)}>
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {me.role === "owner" && <SelectItem value="owner">Owner</SelectItem>}
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Team" htmlFor="invite-team">
                <Select value={teamId} onValueChange={(value) => value && setTeamId(value)}>
                  <SelectTrigger id="invite-team">
                    <SelectValue placeholder="No team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {senders.length > 0 && (
                <Field label="Send from" htmlFor="invite-from">
                  <Select value={fromId} onValueChange={(value) => value && setFromId(value)}>
                    <SelectTrigger id="invite-from">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {senders.map((box) => (
                        <SelectItem key={box.id} value={box.id}>
                          {box.address}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
            <FieldsetActions note="They get an email with a link, choose a password, and they are in. GitHub works too if that account uses the same address.">
              <Button
                variant="solid"
                pill
                loading={sending}
                disabled={!email.trim() || sending}
                onClick={() =>
                  submit(async () => {
                    const result = await inviteMemberAction(
                      email,
                      role,
                      teamId || null,
                      fromId || null,
                    );
                    if (!result.ok) {
                      toast.error(result.error);
                      return;
                    }
                    setEmail("");
                    await navigator.clipboard.writeText(result.link).catch(() => {});
                    toast.success(result.sent ? "Invitation sent" : "Invitation created", {
                      description: result.sent
                        ? `Emailed to ${result.email}. The link is on your clipboard too.`
                        : `It could not be emailed: ${result.reason}. The link is on your clipboard.`,
                    });
                    router.refresh();
                  })
                }
              >
                {!sending && <UserPlus />}
                Invite
              </Button>
            </FieldsetActions>
          </Fieldset>
        )}
      </Panel>

      <Panel
        title="Teams"
        description="A team is a group of people who share the same access. The root team reaches every domain and mailbox."
        meta={`${teams.length}`}
      >
        <div className="divide-y divide-border border-border border-y">
          {teams.map((entry) => {
            const inTeam = people.filter((person) => person.teams.some((t) => t.id === entry.id));
            const outside = people.filter((person) => !person.teams.some((t) => t.id === entry.id));
            const shut = !opened.includes(entry.id);
            const mayChange = mayChangeTeam(entry.id);

            const renaming = editing === entry.id;

            function saveName() {
              submit(async () => {
                const result = await renameTeamAction(entry.id, draft);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                setEditing(null);
                toast.success("Team renamed");
                router.refresh();
              });
            }

            return (
              <div key={entry.id}>
                <div className="flex items-center gap-3 py-3">
                  {renaming ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Input
                        value={draft}
                        autoFocus
                        className="h-8 max-w-56"
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") saveName();
                          if (event.key === "Escape") setEditing(null);
                        }}
                      />
                      <Button
                        variant="solid"
                        size="sm"
                        pill
                        loading={sending}
                        disabled={!draft.trim() || sending}
                        onClick={saveName}
                      >
                        Save
                      </Button>
                      <Button variant="ghost" size="sm" pill onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setOpened((current) =>
                          shut ? [...current, entry.id] : current.filter((id) => id !== entry.id),
                        )
                      }
                      className="-ml-1 flex min-w-0 flex-1 items-start gap-2.5 text-left"
                    >
                      <ChevronDown
                        className={cn(
                          "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                          shut && "-rotate-90",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{entry.name}</span>
                        <span className="block truncate text-[12px] text-muted-foreground">
                          {inTeam.length === 0
                            ? "Nobody yet"
                            : `${inTeam.length} ${inTeam.length === 1 ? "person" : "people"}`}
                        </span>
                      </span>
                    </button>
                  )}

                  {entry.isRoot && !renaming && (
                    <Badge size="sm" tone="accent">
                      Reaches everything
                    </Badge>
                  )}

                  {/* The root team can be renamed like any other: its reach
                      comes from what it is, not from what it is called. */}
                  {!renaming && canManage && (
                    <IconButton
                      label={`Rename ${entry.name}`}
                      onClick={() => {
                        setDraft(entry.name);
                        setEditing(entry.id);
                      }}
                    >
                      <PenLine />
                    </IconButton>
                  )}

                  {!renaming && (
                    <IconButton
                      variant="danger"
                      disabled={entry.isRoot || !canManage}
                      label={
                        entry.isRoot ? "The root team cannot be deleted" : `Delete ${entry.name}`
                      }
                      onClick={() => run(() => deleteTeamAction(entry.id), "Team deleted")}
                    >
                      <Trash2 />
                    </IconButton>
                  )}
                </div>

                {!shut && (
                  <div className="pb-3 pl-7">
                    {inTeam.length === 0 && (
                      <p className="py-2 text-[12.5px] text-muted-foreground">
                        Nobody is in this team yet.
                      </p>
                    )}

                    {inTeam.map((person) => {
                      const membership = person.teams.find((t) => t.id === entry.id);
                      return (
                        <div
                          key={person.memberId}
                          className="flex items-center gap-2.5 border-border/60 border-t py-2 first:border-t-0"
                        >
                          <Avatar size="xs" name={person.name} address={person.email} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px]">{person.name}</span>
                            <span className="block truncate font-mono text-[11.5px] text-muted-foreground">
                              {person.email}
                            </span>
                          </span>

                          <button
                            type="button"
                            disabled={!mayChange}
                            title={
                              membership?.lead
                                ? `Make an ordinary member of ${entry.name}`
                                : `Make a lead of ${entry.name}`
                            }
                            onClick={() =>
                              run(
                                () => setTeamRoleAction(entry.id, person.userId, !membership?.lead),
                                "Team role changed",
                              )
                            }
                            className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                              membership?.lead
                                ? "bg-primary-soft text-primary-soft-foreground"
                                : "bg-muted text-muted-foreground",
                              mayChange && "hover:bg-accent",
                            )}
                          >
                            {membership?.lead ? "lead" : "member"}
                          </button>

                          {mayChange && (
                            <IconButton
                              size="xs"
                              variant="danger"
                              label={`Take ${person.name} out of ${entry.name}`}
                              onClick={() =>
                                run(
                                  () => setTeamMembershipAction(entry.id, person.userId, false),
                                  `Removed from ${entry.name}`,
                                )
                              }
                            >
                              <X />
                            </IconButton>
                          )}
                        </div>
                      );
                    })}

                    {mayChange && outside.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" pill className="mt-2">
                            <UserPlus />
                            Add member
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          className="max-h-72 w-64 overflow-y-auto"
                        >
                          <DropdownMenuLabel>Add to {entry.name}</DropdownMenuLabel>
                          {outside.map((person) => (
                            <DropdownMenuItem
                              key={person.memberId}
                              onSelect={() =>
                                run(
                                  () => setTeamMembershipAction(entry.id, person.userId, true),
                                  `Added to ${entry.name}`,
                                )
                              }
                            >
                              <span className="min-w-0 flex-1 truncate">{person.name}</span>
                              <span className="truncate font-mono text-[11px] text-muted-foreground">
                                {person.email}
                              </span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}

                    {mayChange && outside.length === 0 && inTeam.length > 0 && (
                      <p className="pt-2 text-[12px] text-muted-foreground">
                        Everybody is already in this team.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {teams.length === 0 && <ListEmpty>No teams yet.</ListEmpty>}
        </div>

        {canManage && (
          <Fieldset title="Add a team">
            <Field label="Name" htmlFor="team-name" className="max-w-xs">
              <Input
                id="team-name"
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="Support"
              />
            </Field>
            <FieldsetActions note="Put people in a team from the list above. What a team reaches is set under Access.">
              <Button
                variant="solid"
                pill
                loading={sending}
                disabled={!teamName.trim() || sending}
                onClick={() =>
                  submit(async () => {
                    const result = await createTeamAction(teamName);
                    if (!result.ok) {
                      toast.error(result.error ?? "That did not work");
                      return;
                    }
                    setTeamName("");
                    toast.success("Team created");
                    router.refresh();
                  })
                }
              >
                {!sending && <Plus />}
                Add team
              </Button>
            </FieldsetActions>
          </Fieldset>
        )}
      </Panel>
    </>
  );
}
