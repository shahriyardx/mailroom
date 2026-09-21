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
  inviteMemberAction,
  removeMemberAction,
  resendInvitationAction,
  setMemberRoleAction,
} from "@/server/team";
import { RotateCw, Trash2, UserPlus, X } from "lucide-react";
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
  const router = useRouter();
  const [busy, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [teamId, setTeamId] = useState<string>(teams.find((t) => !t.isRoot)?.id ?? "");
  const [fromId, setFromId] = useState<string>(
    () => (senders.find((box) => box.isDefault) ?? senders[0])?.id ?? "",
  );

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
                  <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">you</span>
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
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{entry.email}</span>
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
  );
}
