"use client";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Note,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/components/kit";
import { Empty, PageHeader, Row, SearchBox, Surface, Toolbar } from "@/components/mail/page-frame";
import {
  cancelBroadcastAction,
  createBroadcastAction,
  startBroadcastAction,
} from "@/server/actions";
import type { BroadcastRow } from "@/server/campaigns";
import { Megaphone, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * One message, written once, sent to a whole list.
 *
 * Writing happens in a dialog rather than on the page. A broadcast is written
 * occasionally and read constantly, so the screen belongs to the list of what
 * has been sent — a compose form sitting permanently above it pushes the
 * thing you actually came to look at below the fold.
 *
 * Sending stays a second, separate press. It is the one action here that
 * cannot be taken back.
 */

const STATUSES = ["all", "draft", "scheduled", "sending", "sent", "cancelled"] as const;

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

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [listFilter, setListFilter] = useState("all");

  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const ready = lists.length > 0 && mailboxes.length > 0;
  const chosen = lists.find((entry) => entry.id === listId);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return broadcasts.filter(
      (entry) =>
        (status === "all" || entry.status === status) &&
        (listFilter === "all" || entry.listId === listFilter) &&
        (!needle ||
          entry.subject.toLowerCase().includes(needle) ||
          entry.listName.toLowerCase().includes(needle)),
    );
  }, [broadcasts, query, status, listFilter]);

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

  const create = (
    <Button variant="solid" disabled={!ready} onClick={() => setOpen(true)}>
      <Plus />
      Create broadcast
    </Button>
  );

  return (
    <>
      <PageHeader title="Broadcasts" count={broadcasts.length}>
        {create}
      </PageHeader>

      {broadcasts.length > 0 ? (
        <Toolbar>
          <SearchBox value={query} onChange={setQuery} placeholder="Search broadcasts…" />
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as (typeof STATUSES)[number])}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {entry === "all" ? "All statuses" : entry}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={listFilter} onValueChange={setListFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All lists</SelectItem>
              {lists.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Toolbar>
      ) : null}

      <Surface>
        {broadcasts.length === 0 ? (
          <Empty
            icon={<Megaphone />}
            title="No broadcasts yet"
            hint={
              ready
                ? "Reach everybody on a list at once. Write one and it is saved as a draft until you send it."
                : lists.length === 0
                  ? "Make a list first — a broadcast has to have somewhere to go."
                  : "Make a mailbox first — a broadcast has to come from an address."
            }
          >
            {ready ? create : null}
          </Empty>
        ) : shown.length === 0 ? (
          <Empty
            icon={<Megaphone />}
            title="Nothing matches"
            hint="No broadcast matches what you have typed or the filters you have set."
          />
        ) : (
          shown.map((entry) => (
            <Row key={entry.id}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-4">
                <Megaphone />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium">{entry.subject}</span>
                  <Badge size="sm" tone={toneFor(entry.status)}>
                    {entry.status}
                  </Badge>
                </div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">
                  {entry.listName}
                  {entry.total > 0
                    ? ` · ${entry.sent} of ${entry.total} sent${
                        entry.failed > 0 ? `, ${entry.failed} failed` : ""
                      }`
                    : ""}
                </div>
              </div>

              {entry.status === "sent" && entry.total > 0 ? (
                <div className="hidden shrink-0 text-right sm:block">
                  <div className="text-[13px] font-medium">
                    {Math.round((entry.opened / Math.max(entry.sent, 1)) * 100)}%
                  </div>
                  <div className="text-[11.5px] text-muted-foreground">opened</div>
                </div>
              ) : null}

              {entry.status === "draft" ? (
                <Button
                  variant="solid"
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
            </Row>
          ))
        )}
      </Surface>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Write a broadcast</DialogTitle>
            <DialogDescription>
              Saved as a draft. Nothing is sent until you press Send on it.
            </DialogDescription>
          </DialogHeader>

          <form
            id="new-broadcast"
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
                setOpen(false);
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

            {chosen && chosen.subscribed === 0 ? (
              <Note>
                Nobody on <strong>{chosen.name}</strong> is subscribed, so this cannot be sent yet.
              </Note>
            ) : null}
          </form>

          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="solid"
              type="submit"
              form="new-broadcast"
              disabled={busy || !subject.trim()}
            >
              Save as draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function toneFor(status: BroadcastRow["status"]) {
  if (status === "sent") return "ok" as const;
  if (status === "sending") return "warn" as const;
  if (status === "cancelled") return "danger" as const;
  return undefined;
}
