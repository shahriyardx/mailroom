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
import { AddressField } from "@/components/mail/address-field";
import {
  createAutomationAction,
  duplicateAutomationAction,
  removeAutomationAction,
} from "@/server/actions";
import type { AutomationRow } from "@/server/automations";
import { CopyPlus, Plus, Trash2, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/** What starts one, in the few words a list row has room for. */
function describeStart(row: AutomationRow) {
  if (!row.trigger) return "no trigger yet";
  const narrowed = row.segmentName ? `, ${row.segmentName} only` : "";
  if (row.trigger === "event") return `on ${row.eventName ?? "an event"}${narrowed}`;
  return `joins ${row.listName ?? "any list"}${narrowed}`;
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
  /** Which row is being copied, so only its own button waits. */
  const [copying, setCopying] = useState<string | null>(null);

  /* A copy opens straight away: changing it is the reason it was made. */
  async function duplicate(row: AutomationRow) {
    setCopying(row.id);
    try {
      const made = await duplicateAutomationAction(row.id);
      if (!made.ok) throw new Error(made.error);
      toast.success(`Copied ${row.name}`);
      router.push(`/campaigns/automations/${made.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy it");
    } finally {
      setCopying(null);
    }
  }

  async function create() {
    setBusy(true);
    try {
      const made = await createAutomationAction({
        name: draft.name,
        mailboxId: draft.mailboxId || null,
      });
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

            <Field label="From" hint="Any address on a domain you have set up">
              <AddressField
                value={mailboxes.find((row) => row.id === draft.mailboxId)?.address ?? ""}
                known={mailboxes.map((row) => row.address)}
                onResolved={(chosen) =>
                  setDraft((current) => ({ ...current, mailboxId: chosen.id }))
                }
              />
            </Field>

            <Note>
              One address for the whole series: a welcome note and its follow-up arriving from two
              different people reads as two different companies. It can be left empty for now and
              filled in before you switch the flow on. What starts it — a list somebody joins, or an
              event your own code posts — is chosen on the canvas.
            </Note>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setMaking(false)}>
              Cancel
            </Button>
            <Button variant="solid" onClick={create} disabled={busy || !draft.name.trim()}>
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
                    {row.steps} {row.steps === 1 ? "box" : "boxes"} · {describeStart(row)}
                    {row.from ? ` · from ${row.from}` : " · no address yet"}
                  </p>
                </div>
                <span className="shrink-0 text-right text-[12px] text-muted-foreground tabular-nums">
                  {row.running} running
                  <br />
                  {row.finished} finished
                </span>
                <span className="relative z-10 flex shrink-0 items-center gap-0.5">
                  <IconButton
                    label={`Duplicate ${row.name}`}
                    disabled={copying === row.id}
                    onClick={() => duplicate(row)}
                  >
                    <CopyPlus />
                  </IconButton>
                  <IconButton
                    variant="danger"
                    label={`Delete ${row.name}`}
                    onClick={() => setRemoving(row)}
                  >
                    <Trash2 />
                  </IconButton>
                </span>
              </ListRow>
            );
          })}
        </List>
      ) : (
        <BlankSlate
          icon={<Workflow />}
          title="No automations yet"
          hint="A welcome series when somebody joins, or a flow your own code starts: a trial ending, an order shipping. Draw it now; pick the address and the list before you switch it on."
        />
      )}
    </Panel>
  );
}
