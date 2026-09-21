"use client";

import {
  Avatar,
  Badge,
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
import { cn } from "@/lib/utils";
import type { Role } from "@/server/access";
import {
  type PersonRow,
  cancelInvitationAction,
  createTeamAction,
  deleteTeamAction,
  inviteMemberAction,
  removeMemberAction,
  resendInvitationAction,
  setMemberRoleAction,
  setTeamMembershipAction,
  setTeamRoleAction,
} from "@/server/team";
import { ChevronDown, Plus, RotateCw, Trash2, UserPlus } from "lucide-react";
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
  me: { userId: string; role: Role };
  /** True for an administrator: roles, invitations, removing people. */
  canManage: boolean;
  /** Teams this person leads, whose membership they may change. */
  leadsTeamIds?: string[];
}

const ROLE_NOTE: Record<Role, string> = {
  owner: "Everything, including adding domains and changing how mail is received.",
  admin: "Mailboxes, people, teams and who may see what. Not domains.",
  member: "Only the mailboxes they are given.",
};

export function PeoplePanel({ people, pending, teams, me, canManage, leadsTeamIds = [] }: Props) {
  // A lead may put people in and out of their own team, and nothing else.
  const mayChangeTeam = (teamId: string) => canManage || leadsTeamIds.includes(teamId);
  const router = useRouter();
  const [busy, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [teamId, setTeamId] = useState<string>(teams.find((t) => !t.isRoot)?.id ?? "");
  const [teamName, setTeamName] = useState("");

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

              {canManage || leadsTeamIds.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex w-28 shrink-0 items-center justify-between gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <span className="truncate">
                        {person.teams.length === 0
                          ? "No team"
                          : person.teams.length === 1
                            ? `${person.teams[0].name}${person.teams[0].lead ? " ★" : ""}`
                            : `${person.teams[0].name}, +${person.teams.length - 1}`}
                      </span>
                      <ChevronDown className="size-3.5 shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel>Teams</DropdownMenuLabel>
                    {teams.map((entry) => {
                      const membership = person.teams.find((t) => t.id === entry.id);
                      const inTeam = Boolean(membership);
                      return (
                        <DropdownMenuCheckboxItem
                          key={entry.id}
                          checked={inTeam}
                          disabled={!mayChangeTeam(entry.id)}
                          // Several teams can be set without the menu closing
                          // between each one.
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() =>
                            run(
                              () => setTeamMembershipAction(entry.id, person.userId, !inTeam),
                              "Teams updated",
                            )
                          }
                        >
                          <span className="truncate">{entry.name}</span>
                          {inTeam && (
                            // The role is per team, so it is set beside the
                            // team rather than on the person.
                            <button
                              type="button"
                              title={
                                membership?.lead
                                  ? `Make an ordinary member of ${entry.name}`
                                  : `Make a lead of ${entry.name}`
                              }
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                run(
                                  () =>
                                    setTeamRoleAction(entry.id, person.userId, !membership?.lead),
                                  "Team role changed",
                                );
                              }}
                              className={cn(
                                "ml-auto rounded-full px-1.5 py-0.5 text-[10.5px] font-medium",
                                membership?.lead
                                  ? "bg-primary-soft text-primary-soft-foreground"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {membership?.lead ? "lead" : "member"}
                            </button>
                          )}
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                person.teams.map((entry) => (
                  <Badge key={entry.id} size="sm" tone={entry.isRoot ? "accent" : "neutral"}>
                    {entry.name}
                  </Badge>
                ))
              )}

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
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {me.role === "owner" && <SelectItem value="owner">Owner</SelectItem>}
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <StatusPill state={person.role === "owner" ? "ok" : "pending"}>
                  {person.role}
                </StatusPill>
              )}

              {canManage && person.role !== "owner" && person.userId !== me.userId && (
                <IconButton
                  variant="danger"
                  label={`Remove ${person.email}`}
                  onClick={() => run(() => removeMemberAction(person.memberId), "Removed")}
                >
                  <Trash2 />
                </IconButton>
              )}
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
              <Field label="Role" htmlFor="invite-role" hint={ROLE_NOTE[role]}>
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
            </div>
            <FieldsetActions note="They get an email with a link, choose a password, and they are in. GitHub works too if that account uses the same address.">
              <Button
                variant="solid"
                pill
                loading={busy}
                disabled={!email.trim()}
                onClick={() =>
                  start(async () => {
                    const result = await inviteMemberAction(email, role, teamId || null);
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
                {!busy && <UserPlus />}
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
        <List>
          {teams.map((entry) => {
            const inTeam = people.filter((person) => person.teams.some((t) => t.id === entry.id));
            return (
              <ListRow key={entry.id}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{entry.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {inTeam.length === 0
                      ? "Nobody yet"
                      : inTeam.map((person) => person.name).join(", ")}
                  </span>
                </span>
                {entry.isRoot && (
                  <Badge size="sm" tone="accent">
                    Reaches everything
                  </Badge>
                )}
                {canManage && !entry.isRoot && (
                  <IconButton
                    variant="danger"
                    label={`Delete ${entry.name}`}
                    onClick={() => run(() => deleteTeamAction(entry.id), "Team deleted")}
                  >
                    <Trash2 />
                  </IconButton>
                )}
              </ListRow>
            );
          })}
          {teams.length === 0 && <ListEmpty>No teams yet.</ListEmpty>}
        </List>

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
                loading={busy}
                disabled={!teamName.trim()}
                onClick={() =>
                  run(async () => {
                    const result = await createTeamAction(teamName);
                    if (result.ok) setTeamName("");
                    return result;
                  }, "Team created")
                }
              >
                {!busy && <Plus />}
                Add team
              </Button>
            </FieldsetActions>
          </Fieldset>
        )}
      </Panel>
    </>
  );
}
