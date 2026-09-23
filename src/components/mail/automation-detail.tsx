"use client";

import {
  Button,
  ConfirmDialog,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/kit";
import { AutomationCanvas } from "@/components/mail/automation-canvas";
import type { Automation } from "@/db/schema";
import { type FlowNode, describeTrigger } from "@/lib/automation-flow";
import { updateAutomationAction } from "@/server/actions";
import { ArrowLeft, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/**
 * One automation: a bar of facts, and the canvas it is drawn on.
 *
 * Everything about the flow itself lives on the canvas, because the question
 * somebody opens this to answer is never "what does email three say" — it is
 * "what happens to a person who joins, and what happens differently to the
 * ones who ignore us".
 */
export function AutomationDetail({
  automation,
  nodes,
  lists,
  segments,
  events,
  mailboxes,
  templates,
  appUrl,
  running,
}: {
  automation: Automation;
  nodes: FlowNode[];
  lists: { id: string; name: string; subscribed: number }[];
  segments: { id: string; listId: string; name: string; size: number }[];
  events: { id: string; name: string; seenCount: number }[];
  mailboxes: { id: string; address: string }[];
  templates: { id: string; name: string }[];
  appUrl: string;
  running: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [name, setName] = useState(automation.name);

  const live = automation.status === "active";
  const emails = nodes.filter((node) => node.kind === "email").length;
  const listName = lists.find((row) => row.id === automation.listId)?.name ?? null;
  const segmentName = segments.find((row) => row.id === automation.segmentId)?.name ?? null;
  const said = describeTrigger(automation.trigger, listName, automation.eventName, segmentName);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Switching one on is not undoable in the way that matters: the first
          person who joins a second later gets mail. */}
      <ConfirmDialog
        open={switching}
        onOpenChange={setSwitching}
        title="Switch this automation on?"
        description={automation.name}
        consequences={
          automation.trigger === "event" ? (
            <>
              Every <strong>{automation.eventName}</strong> your code posts from now on puts that
              person through this flow. Nothing happens to anybody until one arrives, so switching
              this on is safe until your own code starts calling.
            </>
          ) : (
            <>
              Everybody who joins {listName ?? "the list"} from now on is put through this flow.
              People already on the list are left alone — only new joiners are enrolled, so
              switching on a welcome series does not welcome everybody who has been a subscriber for
              two years.
            </>
          )
        }
        confirmLabel="Switch it on"
        onConfirm={() => {
          setSwitching(false);
          void change({ status: "active" });
        }}
      />

      {/* A bar rather than a panel: the canvas below wants every pixel, and
          what sits here is the handful of facts that are not on it. */}
      {/* A toolbar that shrinks rather than wraps. Wrapping inside a fixed
          height put the second row on top of the canvas at 1024px, which is
          an ordinary laptop rather than an edge case. */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-border border-b px-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/campaigns/automations">
            <ArrowLeft />
            Automations
          </Link>
        </Button>

        <span className="h-5 w-px bg-border" />

        {/* Sized to the name rather than to a guess at one. A fixed width
            leaves a hole between "AAA" and the facts beside it, which reads
            as two unrelated bits of the bar instead of one line about one
            automation. Bounded at both ends: wide enough to be a target when
            it is empty, narrow enough that a long name cannot push the
            controls off the right. */}
        <Input
          value={name}
          aria-label="Automation name"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            // An empty name is a slip, not an instruction: snap back rather
            // than save a nameless automation into the list.
            if (!name.trim()) return setName(automation.name);
            if (name.trim() !== automation.name) change({ name: name.trim() });
          }}
          style={{ width: `${Math.min(Math.max(name.length + 2, 5), 30)}ch` }}
          className="h-8 min-w-0 shrink border-transparent bg-transparent px-2 font-medium text-[14px] shadow-none hover:bg-muted focus:border-border focus:bg-card"
        />

        {/* Beside the name rather than adrift in the middle of the bar: it is
            a fact about this automation, not a heading of its own. */}
        {/* The first thing to go when the bar is tight: it is context, and
            the list is named on the trigger card anyway. */}
        <span className="hidden min-w-0 truncate text-[12.5px] text-muted-foreground lg:inline">
          {emails} {emails === 1 ? "email" : "emails"} ·{" "}
          <span className={said.warn ? "text-warn" : undefined}>
            {automation.trigger === "event" ? "on " : ""}
            {said.title.toLowerCase()}
            {automation.trigger !== "event" && listName ? ` ${listName}` : ""}
          </span>
          {live && ` · ${running} part-way through`}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Select
            value={automation.mailboxId}
            onValueChange={(value) => change({ mailboxId: value })}
          >
            <SelectTrigger className="h-8 w-[160px] shrink-0 text-[12.5px] lg:w-[200px]">
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

          {live ? (
            <Button
              variant="outline"
              size="sm"
              pill
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
              pill
              onClick={() => setSwitching(true)}
              disabled={busy || nodes.length === 0 || said.warn}
              title={
                said.warn
                  ? "Choose what starts it first"
                  : nodes.length === 0
                    ? "Put something on the canvas first"
                    : undefined
              }
            >
              <Play />
              Switch on
            </Button>
          )}
        </div>
      </header>

      <AutomationCanvas
        automationId={automation.id}
        nodes={nodes}
        entryNodeId={automation.entryNodeId}
        trigger={automation.trigger}
        eventName={automation.eventName}
        listId={automation.listId}
        segmentId={automation.segmentId}
        lists={lists}
        segments={segments}
        events={events}
        templates={templates}
        appUrl={appUrl}
        live={live}
      />
    </div>
  );
}
