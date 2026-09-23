"use client";

import {
  Badge,
  BlankSlate,
  Button,
  ConfirmDialog,
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
import { humanDelay } from "@/components/mail/template-builder";
import type { Automation, AutomationStep } from "@/db/schema";
import { addStepAction, removeStepAction, updateAutomationAction } from "@/server/actions";
import { ArrowLeft, Clock, Mail, Pause, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/**
 * One automation, as the line of emails it is.
 *
 * Drawn top to bottom with the wait written between each pair, because the
 * thing somebody is checking is never "what does email three say" — it is
 * "how long after joining does this person hear from us four times".
 */
export function AutomationDetail({
  automation,
  steps,
  listName,
  mailboxes,
  running,
}: {
  automation: Automation;
  steps: AutomationStep[];
  listName: string;
  mailboxes: { id: string; address: string }[];
  running: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<AutomationStep | null>(null);
  const [switching, setSwitching] = useState(false);

  const live = automation.status === "active";
  /** How long the whole series takes for one person. */
  const total = steps.reduce((sum, step) => sum + step.delayMinutes, 0);

  async function change(patch: Parameters<typeof updateAutomationAction>[1]) {
    setBusy(true);
    try {
      const result = await updateAutomationAction(automation.id, patch);
      if (!result.ok) throw new Error(result.error);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That could not be changed");
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    setBusy(true);
    try {
      const made = await addStepAction(automation.id, {
        subject: "Untitled",
        // A first email with no wait is a welcome; a later one a day apart is
        // the shape almost every series turns out to want.
        delayMinutes: steps.length === 0 ? 0 : 1440,
      });
      if (!made.ok) throw new Error(made.error);
      router.push(`/campaigns/automations/${automation.id}/steps/${made.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That could not be added");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[880px] space-y-4 p-4">
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="Delete this email?"
        description={removing?.subject}
        consequences="Everybody waiting for it moves on to the next one. Mail already sent is unaffected."
        confirmLabel="Delete email"
        onConfirm={async () => {
          if (!removing) return;
          await removeStepAction(removing.id);
          setRemoving(null);
          toast.success("Email deleted");
          router.refresh();
        }}
      />

      {/* Switching one on is not undoable in the way that matters: the first
          person who joins a second later gets mail. */}
      <ConfirmDialog
        open={switching}
        onOpenChange={setSwitching}
        title="Switch this automation on?"
        description={automation.name}
        consequences={
          <>
            Everybody who joins {listName} from now on is put through {steps.length}{" "}
            {steps.length === 1 ? "email" : "emails"} over {humanDelay(total)}. People already on
            the list are left alone — only new joiners are enrolled.
          </>
        }
        confirmLabel="Switch it on"
        onConfirm={() => {
          setSwitching(false);
          void change({ status: "active" });
        }}
      />

      <Button variant="ghost" size="sm" asChild>
        <Link href="/campaigns/automations">
          <ArrowLeft />
          Automations
        </Link>
      </Button>

      <Panel
        title={automation.name}
        description={`Starts when somebody joins ${listName}.`}
        meta={automation.status}
        action={
          live ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => change({ status: "paused" })}
              disabled={busy}
            >
              <Pause />
              Pause
            </Button>
          ) : (
            <Button
              variant="solid"
              size="sm"
              onClick={() => setSwitching(true)}
              disabled={busy || steps.length === 0}
            >
              <Play />
              Switch on
            </Button>
          )
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="automation-name">
            <Input
              id="automation-name"
              defaultValue={automation.name}
              onBlur={(event) =>
                event.target.value.trim() !== automation.name &&
                change({ name: event.target.value })
              }
            />
          </Field>

          <Field label="From">
            <Select
              value={automation.mailboxId}
              onValueChange={(value) => change({ mailboxId: value })}
            >
              <SelectTrigger>
                <SelectValue />
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
        </div>

        <Note className="mt-3">
          {live
            ? `${running} ${running === 1 ? "person is" : "people are"} part-way through it. Pausing stops the sending without losing where anybody has got to.`
            : "Nothing is sent while this is off. Switching it on enrols people who join from that moment, not the whole list."}
        </Note>
      </Panel>

      <Panel
        title="The series"
        description={
          steps.length > 0
            ? `${steps.length} ${steps.length === 1 ? "email" : "emails"} over ${humanDelay(total)}.`
            : "Nothing in it yet."
        }
        action={
          <Button variant="outline" size="sm" onClick={add} disabled={busy}>
            <Plus />
            Add an email
          </Button>
        }
      >
        {steps.length > 0 ? (
          <List>
            {steps.map((step, index) => (
              <ListRow key={step.id} className="relative items-start">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted font-mono text-[12px] text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/campaigns/automations/${automation.id}/steps/${step.id}`}
                    className="block outline-none after:absolute after:inset-0"
                  >
                    <p className="truncate font-medium text-[13px] hover:underline">
                      {step.subject}
                    </p>
                  </Link>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <Clock className="size-3" />
                    {step.delayMinutes === 0
                      ? index === 0
                        ? "as soon as they join"
                        : "straight after the last one"
                      : `${humanDelay(step.delayMinutes)} after ${index === 0 ? "they join" : "the last one"}`}
                  </p>
                </div>
                {/* An email with no body would go out blank, which is worse
                    than not going out — so it is flagged before it can. */}
                {!step.html && !step.design && (
                  <Badge size="sm" tone="warn">
                    Empty
                  </Badge>
                )}
                <IconButton
                  variant="danger"
                  label={`Delete ${step.subject}`}
                  className="relative z-10"
                  onClick={() => setRemoving(step)}
                >
                  <Trash2 />
                </IconButton>
              </ListRow>
            ))}
          </List>
        ) : (
          <BlankSlate
            icon={<Mail />}
            title="No emails yet"
            hint="The first one usually goes out the moment somebody joins, and the rest follow it a day or a week apart."
          />
        )}
      </Panel>
    </div>
  );
}
