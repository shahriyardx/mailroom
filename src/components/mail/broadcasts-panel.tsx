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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/components/kit";
import {
  cancelBroadcastAction,
  createBroadcastAction,
  startBroadcastAction,
} from "@/server/actions";
import type { BroadcastRow } from "@/server/campaigns";
import { Megaphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * One message, written once, sent to a whole list.
 *
 * Writing and sending are two steps on purpose. A broadcast is the one thing
 * in this app that cannot be taken back once it starts, so it is made as a
 * draft first and sending is a separate, deliberate press.
 */
export function BroadcastsPanel({
  broadcasts,
  lists,
  mailboxes,
}: {
  broadcasts: BroadcastRow[];
  lists: { id: string; name: string; subscribed: number }[];
  mailboxes: { id: string; address: string }[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const chosen = lists.find((entry) => entry.id === listId);

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

  const ready = lists.length > 0 && mailboxes.length > 0;

  return (
    <>
      <Panel
        title="Write a broadcast"
        description="Made as a draft. Nothing is sent until you press Send on it below."
      >
        {!ready ? (
          <Note>
            {lists.length === 0
              ? "Make a list first — a broadcast has to have somewhere to go."
              : "Make a mailbox first — a broadcast has to come from an address."}
          </Note>
        ) : (
          <form
            className="space-y-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!subject.trim()) return;
              startTransition(async () => {
                const result = await createBroadcastAction({
                  listId,
                  mailboxId,
                  subject,
                  html: body || undefined,
                });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Draft saved");
                setSubject("");
                setBody("");
                router.refresh();
              });
            }}
          >
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="To which list">
                <Select value={listId} onValueChange={setListId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name} ({entry.subscribed})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="From">
                <Select value={mailboxId} onValueChange={setMailboxId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {mailboxes.map((box) => (
                      <SelectItem key={box.id} value={box.id}>
                        {box.address}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Subject">
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="What we shipped in March"
                disabled={busy}
              />
            </Field>

            <Field
              label="Body"
              hint="{{name}} and {{address}} are filled in per person. Put {{unsubscribe}} where you want the link, or leave it out and one is added at the bottom."
            >
              <Textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={8}
                placeholder={"<p>Hello {{name}},</p>"}
                disabled={busy}
              />
            </Field>

            <Button type="submit" disabled={busy || !subject.trim()}>
              Save as draft
            </Button>
          </form>
        )}

        {chosen && chosen.subscribed === 0 ? (
          <Note className="mt-3">
            Nobody on <strong>{chosen.name}</strong> is subscribed, so this cannot be sent yet.
          </Note>
        ) : null}
      </Panel>

      <Panel
        title="Broadcasts"
        meta={broadcasts.length > 0 ? broadcasts.length : undefined}
        description="What has been written, and what happened to it."
      >
        {broadcasts.length === 0 ? (
          <BlankSlate
            icon={<Megaphone />}
            title="Nothing sent yet"
            hint="Write one above. It is saved as a draft first."
          />
        ) : (
          <List>
            {broadcasts.map((entry) => (
              <ListRow key={entry.id}>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
                  <Megaphone />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{entry.subject}</span>
                    <Badge
                      size="sm"
                      tone={
                        entry.status === "sent"
                          ? "ok"
                          : entry.status === "sending"
                            ? "warn"
                            : entry.status === "cancelled"
                              ? "danger"
                              : undefined
                      }
                    >
                      {entry.status}
                    </Badge>
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {entry.listName}
                    {entry.total > 0
                      ? ` · ${entry.sent} of ${entry.total} sent${
                          entry.failed > 0 ? `, ${entry.failed} failed` : ""
                        }`
                      : ""}
                  </div>
                </div>

                {entry.status === "draft" ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    title="Sends to everyone subscribed to that list. This cannot be undone."
                    onClick={() => run(() => startBroadcastAction(entry.id), "Sending started")}
                  >
                    Send
                  </Button>
                ) : null}

                {entry.status === "scheduled" || entry.status === "sending" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    title="Stops it. Anything already sent has gone."
                    onClick={() => run(() => cancelBroadcastAction(entry.id), "Stopped")}
                  >
                    Stop
                  </Button>
                ) : null}
              </ListRow>
            ))}
          </List>
        )}
      </Panel>
    </>
  );
}
