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
  Textarea,
} from "@/components/kit";
import { createEventAction, removeEventAction } from "@/server/actions";
import type { EventRow } from "@/server/custom-events";
import { Check, Copy, Plus, Trash2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/**
 * The events this account's own code can post.
 *
 * A registry rather than free text, for one reason: a mistyped string sent
 * from a server somewhere is invisible. Declared, an automation can offer the
 * name in a list — and a name that arrives having never been declared still
 * lands here, marked, because that is the answer to "why did my flow not
 * run" and it can only be given if it was kept.
 */
export function CustomEventsPanel({
  events,
  appUrl,
}: {
  events: EventRow[];
  appUrl: string;
}) {
  const router = useRouter();
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<EventRow | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "" });

  async function create() {
    setBusy(true);
    try {
      const made = await createEventAction(draft);
      if (!made.ok) throw new Error(made.error);
      setMaking(false);
      toast.success("Event added");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That could not be made");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Events"
        description="Things that happen in your own product. Post one and whatever automation is waiting for it starts, for that person."
        meta={`${events.length}`}
        action={
          <Button
            variant="solid"
            pill
            onClick={() => {
              setDraft({ name: "", description: "" });
              setMaking(true);
            }}
          >
            <Plus />
            New event
          </Button>
        }
      >
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(next) => !next && setRemoving(null)}
          title="Forget this event?"
          description={removing?.name}
          consequences={
            (removing?.usedBy ?? 0) > 0 ? (
              <>
                {removing?.usedBy} {removing?.usedBy === 1 ? "automation" : "automations"} still
                waits for this name. They are left exactly as they are — forgetting the name here
                does not change what they do, it only takes it off this list.
              </>
            ) : (
              "It stops being offered when you pick a trigger. Posting it again puts it straight back, marked as undeclared."
            )
          }
          confirmLabel="Forget it"
          onConfirm={async () => {
            if (!removing) return;
            await removeEventAction(removing.id);
            setRemoving(null);
            toast.success("Forgotten");
            router.refresh();
          }}
        />

        <Dialog open={making} onOpenChange={setMaking}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New event</DialogTitle>
              <DialogDescription>
                A name your code will post. Nothing happens until an automation is set to wait for
                it.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <Field
                label="Name"
                hint="Lowercase, dots and dashes. trial.ended, order.shipped, card.declined."
              >
                <Input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="trial.ended"
                  className="font-mono"
                />
              </Field>

              <Field label="What it means" hint="For whoever reads this in six months.">
                <Textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Posted by the billing worker the night a free trial runs out."
                  rows={3}
                />
              </Field>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setMaking(false)}>
                Cancel
              </Button>
              <Button variant="solid" onClick={create} disabled={busy || !draft.name.trim()}>
                Add it
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {events.length > 0 ? (
          <List>
            {events.map((row) => (
              <ListRow key={row.id} className="items-start">
                <Zap className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium font-mono text-[13px]">{row.name}</span>
                    {!row.declared && (
                      <Badge size="sm" tone="warn">
                        Not declared
                      </Badge>
                    )}
                    {row.liveUsedBy > 0 && (
                      <Badge size="sm" tone="ok">
                        {row.liveUsedBy} running
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {row.description ||
                      (row.declared
                        ? "No description"
                        : "Arrived from the API before anybody declared it")}
                  </p>
                </div>
                <span className="shrink-0 text-right text-[12px] text-muted-foreground tabular-nums">
                  {row.seenCount} received
                  <br />
                  {row.lastSeenAt ? row.lastSeenAt.toLocaleDateString() : "never"}
                </span>
                <IconButton
                  variant="danger"
                  label={`Forget ${row.name}`}
                  onClick={() => setRemoving(row)}
                >
                  <Trash2 />
                </IconButton>
              </ListRow>
            ))}
          </List>
        ) : (
          <BlankSlate
            icon={<Zap />}
            title="No events yet"
            hint="Name one here, then set an automation to wait for it. Or just post one — an unknown name is recorded rather than refused."
          />
        )}
      </Panel>

      <HowToSend appUrl={appUrl} name={events[0]?.name ?? "trial.ended"} />
    </div>
  );
}

/**
 * The call itself, written out with a name from this account in it.
 *
 * A generic example is something to adapt; one carrying a real event name is
 * something to paste, and the difference is most of the work.
 */
function HowToSend({ appUrl, name }: { appUrl: string; name: string }) {
  const [copied, setCopied] = useState(false);

  const call = [
    `curl -X POST ${appUrl}/api/v1/events \\`,
    `  -H "Authorization: Bearer YOUR_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `        "event": "${name}",`,
    `        "email": "person@example.com",`,
    `        "fields": { "plan": "pro" },`,
    `        "consent_source": "signed up at checkout"`,
    `      }'`,
  ].join("\n");

  return (
    <Panel title="Posting one" description="Any key with the Events scope can do this.">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11.5px] leading-relaxed">
        {call}
      </pre>

      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(call);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <Note>
        The reply names every automation that heard it and what happened to that person in each —
        started, restarted, or skipped and why. <code className="font-mono">consent_source</code> is
        only needed for somebody not on the list yet: without it an unknown address is skipped
        rather than quietly subscribed.
      </Note>
    </Panel>
  );
}
