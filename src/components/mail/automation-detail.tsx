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
import type { FlowNode } from "@/lib/automation-flow";
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
  listName,
  mailboxes,
  templates,
  running,
}: {
  automation: Automation;
  nodes: FlowNode[];
  listName: string;
  mailboxes: { id: string; address: string }[];
  templates: { id: string; name: string }[];
  running: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);

  const live = automation.status === "active";
  const emails = nodes.filter((node) => node.kind === "email").length;

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
          <>
            Everybody who joins {listName} from now on is put through this flow. People already on
            the list are left alone — only new joiners are enrolled, so switching on a welcome
            series does not welcome everybody who has been a subscriber for two years.
          </>
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

        <Input
          defaultValue={automation.name}
          aria-label="Automation name"
          onBlur={(event) =>
            event.target.value.trim() !== automation.name && change({ name: event.target.value })
          }
          className="h-8 w-40 min-w-0 shrink border-transparent bg-transparent px-2 font-medium text-[14px] shadow-none hover:bg-muted focus:border-border focus:bg-card lg:w-52"
        />

        {/* Beside the name rather than adrift in the middle of the bar: it is
            a fact about this automation, not a heading of its own. */}
        {/* The first thing to go when the bar is tight: it is context, and
            the list is named on the trigger card anyway. */}
        <span className="hidden min-w-0 truncate text-[12.5px] text-muted-foreground lg:inline">
          {emails} {emails === 1 ? "email" : "emails"} · to {listName}
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
              disabled={busy || nodes.length === 0}
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
        listName={listName}
        templates={templates}
        live={live}
      />
    </div>
  );
}
