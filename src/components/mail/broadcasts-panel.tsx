"use client";

import {
  Badge,
  Button,
  ConfirmDialog,
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
} from "@/components/kit";
import { AddressField } from "@/components/mail/address-field";
import { Empty, PageHeader, Row, SearchBox, Surface, Toolbar } from "@/components/mail/page-frame";
import {
  cancelBroadcastAction,
  createBroadcastAction,
  duplicateBroadcastAction,
  startBroadcastAction,
} from "@/server/actions";
import type { BroadcastRow } from "@/server/campaigns";
import { Copy, Megaphone, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * One message, written once, sent to a whole list.
 *
 * Writing happens in a dialog rather than on the page. A campaign is written
 * occasionally and read constantly, so the screen belongs to the list of what
 * has been sent — a compose form sitting permanently above it pushes the
 * thing you actually came to look at below the fold.
 *
 * Sending stays a second, separate press. It is the one action here that
 * cannot be taken back.
 */

const STATUSES = ["all", "draft", "scheduled", "sending", "sent", "cancelled"] as const;

/** The "no list yet" option. A sentinel, because a Select cannot hold "". */
const LATER = "__later";

export function BroadcastsPanel({
  broadcasts,
  lists,
  mailboxes,
  templates,
}: {
  broadcasts: BroadcastRow[];
  lists: { id: string; name: string; subscribed: number }[];
  mailboxes: { id: string; address: string }[];
  templates: { id: string; name: string }[];
}) {
  const router = useRouter();
  /** The campaign a Send button has been pressed on, before it is confirmed. */
  const [sending, setSending] = useState<BroadcastRow | null>(null);
  const [busy, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [listFilter, setListFilter] = useState("all");

  /** Empty is allowed: the list can be chosen in the builder, or at send. */
  const [listId, setListId] = useState(LATER);
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [templateId, setTemplateId] = useState("none");

  const chosen = lists.find((entry) => entry.id === listId);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return broadcasts.filter(
      (entry) =>
        (status === "all" || entry.status === status) &&
        (listFilter === "all" || entry.listId === listFilter) &&
        (!needle ||
          entry.subject.toLowerCase().includes(needle) ||
          entry.listName?.toLowerCase().includes(needle)),
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
    /*
     * Never disabled.
     *
     * Writing one used to need a list and a sending address, neither of which
     * exists on the day an instance is installed — so somebody with an idea
     * had nowhere to put it. Who it goes to and who it comes from are asked
     * for at the moment before sending instead.
     */
    <Button variant="solid" size="md" onClick={() => setOpen(true)}>
      <Plus />
      Create campaign
    </Button>
  );

  return (
    <>
      <PageHeader title="Campaigns" count={broadcasts.length}>
        {create}
      </PageHeader>

      {broadcasts.length > 0 ? (
        <Toolbar>
          <SearchBox value={query} onChange={setQuery} placeholder="Search campaigns…" />
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

      {/*
        Sending is the one thing on this screen that cannot be called back, so
        it is asked about rather than done. The builder's Send asks too; a
        button here that fired on one click would mean the same action had two
        very different amounts of protection depending on where it was pressed.
      */}
      <ConfirmDialog
        open={sending !== null}
        onOpenChange={(next) => !next && setSending(null)}
        title="Send this campaign now?"
        description={sending?.subject}
        consequences={
          <>
            It goes to everybody the campaign is aimed at on {sending?.listName}. This cannot be
            called back once it starts.
          </>
        }
        confirmLabel="Send it"
        onConfirm={() => {
          if (!sending) return;
          const going = sending;
          setSending(null);
          run(() => startBroadcastAction(going.id), "Sending started");
        }}
      />

      <Surface>
        {broadcasts.length === 0 ? (
          <Empty
            icon={<Megaphone />}
            title="No campaigns yet"
            hint={
              "Reach everybody on a list at once. Write one and it is saved as a draft until you send it — who it goes to and who it comes from can both be decided later."
            }
          >
            {create}
          </Empty>
        ) : shown.length === 0 ? (
          <Empty
            icon={<Megaphone />}
            title="Nothing matches"
            hint="No campaign matches what you have typed or the filters you have set."
          />
        ) : (
          shown.map((entry) => (
            <Row key={entry.id}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-4">
                <Megaphone />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* One address for both: a draft opens in the builder, and
                      anything that has started opens as its report. */}
                  <Link
                    href={`/campaigns/broadcasts/${entry.id}`}
                    className="truncate font-medium text-[13.5px] hover:underline"
                  >
                    {entry.subject}
                  </Link>
                  <Badge size="sm" tone={toneFor(entry.status)}>
                    {entry.status}
                  </Badge>
                </div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">
                  {entry.listName ?? "No list yet"}
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
                <Button variant="solid" size="sm" disabled={busy} onClick={() => setSending(entry)}>
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

              {/* The second campaign is almost always the first one again with
                  a different subject, so copying is a button rather than a
                  thing to rebuild. */}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                title="Copies the message into a new draft."
                onClick={() =>
                  startTransition(async () => {
                    const made = await duplicateBroadcastAction(entry.id);
                    if (!made.ok) {
                      toast.error(made.error);
                      return;
                    }
                    router.push(`/campaigns/broadcasts/${made.id}`);
                  })
                }
              >
                <Copy />
              </Button>
            </Row>
          ))
        )}
      </Surface>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Write a campaign</DialogTitle>
            <DialogDescription>
              Saved as a draft, and opened in the builder. Nothing is sent until you press Send on
              it.
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
                  listId: listId === LATER ? null : listId,
                  mailboxId: mailboxId || null,
                  subject,
                  templateId: templateId === "none" ? null : templateId,
                });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                setSubject("");
                setTemplateId("none");
                setOpen(false);
                // Straight into the builder: the dialog took the two facts
                // that cannot be changed later, and the writing happens where
                // there is room for it.
                router.push(`/campaigns/broadcasts/${result.id}`);
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
                    <SelectItem value={LATER}>Decide later</SelectItem>
                    {lists.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name} ({entry.subscribed})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="From" hint="Any address on a domain you have set up">
                <AddressField
                  value={mailboxes.find((box) => box.id === mailboxId)?.address ?? ""}
                  known={mailboxes.map((box) => box.address)}
                  onResolved={(chosen) => setMailboxId(chosen.id)}
                />
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

            {/* The body is written in the builder on the next screen. What
                is asked here is only what cannot be changed afterwards — who
                it goes to and who it comes from — plus where to start. */}
            <Field
              label="Start from"
              hint="A template is copied, not linked: editing it later will not change this campaign."
            >
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">A blank email</SelectItem>
                  {templates.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
