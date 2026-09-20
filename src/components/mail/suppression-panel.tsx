"use client";

import { removeSuppressionAction } from "@/server/actions";
import { ShieldOff, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { EmptyNote, Panel, StatusPill } from "./settings-ui";

interface Row {
  id: string;
  address: string;
  reason: string;
  createdAt: Date;
}

export function SuppressionPanel({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [, start] = useTransition();

  return (
    <Panel
      title="Blocked addresses"
      description="Added automatically after a hard bounce or a spam complaint. Sending to these is refused."
      meta={`${rows.length}`}
    >
      <div className="divide-y rounded-sm border">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2 px-3 py-2">
            <ShieldOff className="size-3.5 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{row.address}</span>
            <StatusPill state="bad">{row.reason}</StatusPill>
            <span className="text-[11px] text-muted-foreground">
              {row.createdAt.toLocaleDateString()}
            </span>
            <button
              type="button"
              aria-label={`Unblock ${row.address}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() =>
                start(async () => {
                  await removeSuppressionAction(row.id);
                  router.refresh();
                })
              }
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="px-3 py-3">
            <EmptyNote>nothing blocked</EmptyNote>
          </div>
        )}
      </div>
    </Panel>
  );
}
