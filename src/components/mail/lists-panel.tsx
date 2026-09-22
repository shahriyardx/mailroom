"use client";

import {
  Badge,
  BlankSlate,
  Button,
  Field,
  Input,
  List,
  ListRow,
  Note,
  Panel,
  Textarea,
} from "@/components/kit";
import {
  addListMembersAction,
  createListAction,
  removeListAction,
  removeListMemberAction,
  setListMemberStatusAction,
} from "@/server/actions";
import type { ListRow as ListSummary, MemberRow } from "@/server/campaigns";
import { ListChecks, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Who a broadcast goes to.
 *
 * The consent line is not decoration and is not optional. Somebody will
 * eventually ask why they are being emailed, and the answer has to be better
 * than a shrug — so every way of adding people asks where they came from, and
 * the answer is stored against each of them.
 */
export function ListsPanel({
  lists,
  selected,
  members,
}: {
  lists: ListSummary[];
  selected: ListSummary | null;
  members: MemberRow[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [source, setSource] = useState("");

  function run(work: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error ?? "That did not work");
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  return (
    <>
      <Panel
        title="Lists"
        meta={lists.length > 0 ? lists.length : undefined}
        description="A group of people who agreed to hear from you. Someone can be on more than one, and leaving one does not touch the others."
      >
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            run(() => createListAction(name), "List made");
            setName("");
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Newsletter"
            className="min-w-0 flex-1"
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            Make a list
          </Button>
        </form>

        {lists.length === 0 ? (
          <BlankSlate
            icon={<ListChecks />}
            title="No lists yet"
            hint="A broadcast goes to a list, so this is the first thing to make."
          />
        ) : (
          <List>
            {lists.map((entry) => (
              <ListRow key={entry.id}>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
                  <ListChecks />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`/settings/lists?list=${entry.id}`}
                      className="truncate text-[13px] font-medium hover:underline"
                    >
                      {entry.name}
                    </a>
                    {entry.id === selected?.id ? (
                      <Badge size="sm" tone="ok">
                        Open
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {entry.subscribed} subscribed
                    {entry.total > entry.subscribed
                      ? `, ${entry.total - entry.subscribed} not`
                      : ""}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  title="Deletes the list and everyone on it"
                  onClick={() => run(() => removeListAction(entry.id), "List removed")}
                >
                  Remove
                </Button>
              </ListRow>
            ))}
          </List>
        )}
      </Panel>

      {selected ? (
        <Panel
          title={selected.name}
          meta={members.length > 0 ? members.length : undefined}
          description="Everybody on this list, and where each of them came from."
        >
          <form
            className="mb-4 space-y-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!paste.trim()) return;
              startTransition(async () => {
                const result = await addListMembersAction(selected.id, paste, source);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success(
                  `${result.added} added${result.skipped ? `, ${result.skipped} already on it` : ""}${
                    result.rejected ? `, ${result.rejected} not an address` : ""
                  }`,
                );
                setPaste("");
                router.refresh();
              });
            }}
          >
            <Field label="Addresses" hint="One per line. Add a name after a comma if you have one.">
              <Textarea
                value={paste}
                onChange={(event) => setPaste(event.target.value)}
                placeholder={"ada@example.com, Ada Lovelace\nbob@example.com"}
                rows={4}
                disabled={busy}
              />
            </Field>
            <Field
              label="Where did they come from?"
              hint="Stored against each person. You will want this the day somebody asks why you are emailing them."
            >
              <Input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="signup form / imported from Mailchimp / added by hand"
                disabled={busy}
              />
            </Field>
            <Button type="submit" disabled={busy || !paste.trim()}>
              Add to {selected.name}
            </Button>
          </form>

          <Note className="mb-4">
            Somebody already on the list is left exactly as they are. Re-importing last month's file
            will not resubscribe anybody who has left since.
          </Note>

          {members.length === 0 ? (
            <BlankSlate
              icon={<Users />}
              title="Nobody on this list yet"
              hint="Paste some addresses above."
            />
          ) : (
            <List>
              {members.map((person) => (
                <ListRow key={person.id}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-[12.5px]">{person.address}</span>
                      <Badge
                        size="sm"
                        tone={
                          person.status === "subscribed"
                            ? "ok"
                            : person.status === "unsubscribed"
                              ? "warn"
                              : "danger"
                        }
                      >
                        {person.status}
                      </Badge>
                    </div>
                    <div className="text-[12px] text-muted-foreground">
                      {person.consentSource ?? "No source recorded"}
                    </div>
                  </div>

                  {person.status === "subscribed" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => setListMemberStatusAction(person.id, "unsubscribed"),
                          "Taken off the list",
                        )
                      }
                    >
                      Unsubscribe
                    </Button>
                  ) : null}

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => run(() => removeListMemberAction(person.id), "Removed")}
                  >
                    Remove
                  </Button>
                </ListRow>
              ))}
            </List>
          )}
        </Panel>
      ) : null}
    </>
  );
}
