"use client";

import {
  Button,
  ColorPicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Hint,
  IconButton,
  Input,
  PALETTE,
} from "@/components/kit";
import type { Label as LabelRow } from "@/db/schema";
import { createLabelAction, setThreadsLabelAction } from "@/server/actions";
import { Plus, Settings2, Tag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface Props {
  /** One thread from the reading pane, or every selected thread from the list. */
  threadIds: string[];
  labels: LabelRow[];
  /** Labels already on the thread. Left empty for a multiple selection. */
  applied?: string[];
  onDone?: () => void;
}

/** Puts a label on a conversation, or takes one off. */
export function LabelMenu({ threadIds, labels, applied = [], onDone }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PALETTE[0]);

  function toggle(labelId: string, on: boolean) {
    start(async () => {
      await setThreadsLabelAction(threadIds, labelId, on);
      onDone?.();
      router.refresh();
    });
  }

  /**
   * A label almost always exists because something in front of you needs it.
   * Making one from the settings screen means going there, coming back, and
   * finding the conversation again, so it is made here and put straight on.
   */
  function create() {
    const trimmed = name.trim();
    if (!trimmed) return;

    start(async () => {
      const { id } = await createLabelAction(trimmed, color);
      await setThreadsLabelAction(threadIds, id, true);
      setName("");
      setCreating(false);
      onDone?.();
      router.refresh();
    });
  }

  return (
    <>
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) setName("");
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New label</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 px-1">
            <Field label="Name" htmlFor="new-label-name">
              <Input
                id="new-label-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && create()}
                placeholder="Newsletters"
                autoFocus
              />
            </Field>
            <Field label="Colour">
              <ColorPicker value={color} onChange={setColor} palette={PALETTE} />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="ghost" pill onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              variant="solid"
              pill
              loading={pending}
              disabled={!name.trim() || pending}
              onClick={create}
            >
              Create and apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DropdownMenu>
        <Hint label="Label">
          <DropdownMenuTrigger asChild>
            <IconButton label="Label" size="md" disabled={pending || threadIds.length === 0}>
              <Tag />
            </IconButton>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            {threadIds.length > 1 ? `Label ${threadIds.length} conversations` : "Labels"}
          </DropdownMenuLabel>
          {labels.map((item) => {
            const on = applied.includes(item.id);
            return (
              <DropdownMenuCheckboxItem
                key={item.id}
                checked={on}
                // Radix closes the menu on select; keeping it open lets you put
                // several labels on at once.
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(next) => toggle(item.id, next === true)}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: item.color }}
                  aria-hidden
                />
                <span className="truncate">{item.name}</span>
              </DropdownMenuCheckboxItem>
            );
          })}
          {labels.length === 0 && (
            <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">No labels yet.</p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus /> New label
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings/labels">
              <Settings2 /> Manage labels
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
