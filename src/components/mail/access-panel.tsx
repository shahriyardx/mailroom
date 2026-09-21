"use client";

import {
  Badge,
  Button,
  Checkbox,
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
import { type GrantRow, removeGrantAction, setGrantAction } from "@/server/team";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
  const [resourceId, setResourceId] = useState("");
  const [canSend, setCanSend] = useState(true);
  const [canManage, setCanManage] = useState(false);

  // The root team is not offered: it reaches everything already.
  const subjects: { id: string; label: string }[] =
    subjectType === "team"
      ? teams.filter((entry) => !entry.isRoot).map((entry) => ({ id: entry.id, label: entry.name }))
      : members.map((entry) => ({ id: entry.id, label: entry.name }));

  const resources: { id: string; label: string }[] =
    resourceType === "domain"
      ? domains.map((entry) => ({ id: entry.id, label: entry.name }))
      : mailboxes.map((entry) => ({ id: entry.id, label: entry.address }));

  function add() {
    start(async () => {
      const result = await setGrantAction({
        subjectType,
        subjectId,
        resourceType,
        resourceId,
        canRead: true,
        canSend,
        canManage,
      });
      if (!result.ok) return;
      toast.success("Access granted");
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
          <ListRow key={grant.id}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {grant.subjectName}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {grant.subjectType === "team" ? "team" : "person"}
                </span>
              </span>
              <span className="block truncate font-mono text-[12px] text-muted-foreground">
                {grant.resourceName}
                {grant.resourceType === "domain" && " — whole domain"}
              </span>
            </span>

            <Badge size="sm" tone="neutral">
              Read
            </Badge>
            {grant.canSend && (
              <Badge size="sm" tone="accent">
                Send as
              </Badge>
            )}
            {grant.canManage && (
              <Badge size="sm" tone="warn">
                Manage
              </Badge>
            )}

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

      <Fieldset title="Grant access">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Give access to" htmlFor="grant-subject-type">
            <div className="flex gap-2">
              <Select
                value={subjectType}
                onValueChange={(value) => {
                  if (!value) return;
                  setSubjectType(value as "team" | "member");
                  setSubjectId("");
                }}
              >
                <SelectTrigger id="grant-subject-type" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">A team</SelectItem>
                  <SelectItem value="member">One person</SelectItem>
                </SelectContent>
              </Select>
              <Select value={subjectId} onValueChange={(value) => value && setSubjectId(value)}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Field>

          <Field label="To" htmlFor="grant-resource-type">
            <div className="flex gap-2">
              <Select
                value={resourceType}
                onValueChange={(value) => {
                  if (!value) return;
                  setResourceType(value as "domain" | "mailbox");
                  setResourceId("");
                }}
              >
                <SelectTrigger id="grant-resource-type" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mailbox">One mailbox</SelectItem>
                  <SelectItem value="domain">A whole domain</SelectItem>
                </SelectContent>
              </Select>
              <Select value={resourceId} onValueChange={(value) => value && setResourceId(value)}>
                <SelectTrigger className="flex-1 font-mono text-[12.5px]">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {resources.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id} className="font-mono">
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-5">
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Checkbox checked disabled id="grant-read" />
            <label htmlFor="grant-read">Read</label>
          </span>
          <span className="flex items-center gap-2 text-[13px]">
            <Checkbox
              id="grant-send"
              checked={canSend}
              onCheckedChange={(value) => setCanSend(value === true)}
            />
            <label htmlFor="grant-send">Send as</label>
          </span>
          <span className="flex items-center gap-2 text-[13px]">
            <Checkbox
              id="grant-manage"
              checked={canManage}
              onCheckedChange={(value) => setCanManage(value === true)}
            />
            <label htmlFor="grant-manage">Manage the mailbox</label>
          </span>
        </div>

        <FieldsetActions note="Reading always comes with a grant: sending or managing something you cannot see would mean nothing.">
          <Button
            variant="solid"
            pill
            loading={busy}
            disabled={!subjectId || !resourceId}
            onClick={add}
          >
            {!busy && <Plus />}
            Grant
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
