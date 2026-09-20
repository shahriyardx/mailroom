"use client";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  IconButton,
} from "@/components/kit";
import type { Label as LabelRow } from "@/db/schema";
import { setThreadsLabelAction } from "@/server/actions";
import { Settings2, Tag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

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

  function toggle(labelId: string, on: boolean) {
    start(async () => {
      await setThreadsLabelAction(threadIds, labelId, on);
      onDone?.();
      router.refresh();
    });
  }

  return (
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
        <DropdownMenuItem asChild>
          <Link href="/settings/labels">
            <Settings2 /> Manage labels
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
