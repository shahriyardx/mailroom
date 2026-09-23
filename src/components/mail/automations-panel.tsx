"use client";

import {
  Badge,
  BlankSlate,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  IconButton,
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
} from "@/components/kit";
import { createAutomationAction, removeAutomationAction } from "@/server/actions";
import type { AutomationRow } from "@/server/automations";
import { Plus, Trash2, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/** What starts one, in the few words a list row has room for. */
function describeStart(row: AutomationRow) {
  if (!row.trigger) return "no trigger yet";
  const narrowed = row.segmentName ? `, ${row.segmentName} only` : "";
  if (row.trigger === "event") return `on ${row.eventName ?? "an event"}${narrowed}`;
  return `joins ${row.listName ?? "a list"}${narrowed}`;
}

const LOOK = {
  active: { tone: "ok", label: "Running" },
  paused: { tone: "warn", label: "Paused" },
  draft: { tone: "neutral", label: "Draft" },
} as const;

/**
 * Series that start when somebody joins a list.
 *
 * Listed by what they are doing rather than what they are: the number worth
 * seeing at a glance is how many people are part-way through one, because
 * that is the number that keeps moving without anybody pressing anything.
 */
export function AutomationsPanel({
  automations,
  lists,
  mailboxes,
}: {
  automations: AutomationRow[];
  lists: { id: string; name: string; subscribed: number }[];
  mailboxes: { id: string; address: string }[];
}) {
  const router = useRouter();
  const [making, setMaking] = useState(false);
  const [removing, setRemoving] = useState<AutomationRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: "", mailboxId: "" });

  async function create() {
    setBusy(true);
    try {
      const made = await createAutomationAction(draft);
      if (!made.ok) throw new Error(made.error);
      setMaking(false);
      router.push(`/campaigns/automations/${made.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That could not be made");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Automations"
      description="A series of emails on somebody's own clock — started when they join a list, or by an event your code posts."
      meta={`${automations.length}`}
      action={
        <Button
          variant="solid"
          pill
          onClick={() => {
            setDraft({ name: "", mailboxId: mailboxes[0]?.id ?? "" });
            setMaking(true);
          }}
          disabled={mailboxes.length === 0}
        >
          <Plus />
          New automation
        </Button>
      }
    >
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="Delete this automation?"
        description={removing?.name}
        consequences={
          <>
            {removing?.running ?? 0} {(removing?.running ?? 0) === 1 ? "person is" : "people are"}{" "}
            part-way through it. They stop where they are and get nothing more. Mail already sent is
            unaffected.
          </>
        }
        confirmLabel="Delete automation"
        onConfirm={async () => {
          if (!removing) return;
          await removeAutomationAction(removing.id);
          setRemoving(null);
          toast.success("Automation deleted");
          router.refresh();
        }}
      />

      <Dialog open={making} onOpenChange={setMaking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New automation</DialogTitle>
            <DialogDescription>
              It starts as a draft on an empty canvas. What starts it, and what it does, are both
              chosen there.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Welcome series"
              />
            </Field>

            <Field label="From">
              <Select
                value={draft.mailboxId}
                onValueChange={(value) => setDraft((current) => ({ ...current, mailboxId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick an address" />
                </SelectTrigger>
                <SelectContent>
                  {mailboxes.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.address}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Note>
              One address for the whole series: a welcome note and its follow-up arriving from two
              different people reads as two different companies. You pick what starts it — a list
              somebody joins, or an event your own code posts — on the canvas.
            </Note>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setMaking(false)}>
              Cancel
            </Button>
            <Button
              variant="solid"
              onClick={create}
              disabled={busy || !draft.name.trim() || !draft.mailboxId}
            >
              Make it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {automations.length > 0 ? (
        <List>
          {automations.map((row) => {
            const look = LOOK[row.status];
            return (
              <ListRow key={row.id} className="relative items-start">
                <Workflow className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/campaigns/automations/${row.id}`}
                    className="block outline-none after:absolute after:inset-0"
                  >
                    <p className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-[13px] hover:underline">
                        {row.name}
                      </span>
                      <Badge size="sm" tone={look.tone}>
                        {look.label}
                      </Badge>
                    </p>
                  </Link>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {row.steps} {row.steps === 1 ? "box" : "boxes"} · {describeStart(row)} · from{" "}
                    {row.from}
                  </p>
                </div>
                <span className="shrink-0 text-right text-[12px] text-muted-foreground tabular-nums">
                  {row.running} running
                  <br />
                  {row.finished} finished
                </span>
                <IconButton
                  variant="danger"
                  label={`Delete ${row.name}`}
                  className="relative z-10"
                  onClick={() => setRemoving(row)}
                >
                  <Trash2 />
                </IconButton>
              </ListRow>
            );
          })}
        </List>
      ) : (
        <BlankSlate
          icon={<Workflow />}
          title={
            mailboxes.length === 0
              ? "Add a mailbox first"
              : lists.length === 0
                ? "Make a list first"
                : "No automations yet"
          }
          hint="A welcome series when somebody joins, or a flow your own code starts: a trial ending, an order shipping."
        />
      )}
    </Panel>
  );
}
