"use client";

import { IconButton, List, ListEmpty, ListRow, Panel, StatusPill } from "@/components/kit";
import { removeSuppressionAction } from "@/server/actions";
import { ShieldOff, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

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
      title="Suppression list"
      description="Added automatically after a hard bounce or a spam complaint. Sending to these is refused."
      meta={`${rows.length}`}
    >
      <List>
        {rows.map((row) => (
          <ListRow key={row.id}>
            <ShieldOff className="size-4 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{row.address}</span>
            <StatusPill state="bad">{row.reason}</StatusPill>
            <span className="text-[12px] text-muted-foreground">
              {row.createdAt.toLocaleDateString()}
            </span>
            <IconButton
              label={`Unblock ${row.address}`}
              onClick={() =>
                start(async () => {
                  await removeSuppressionAction(row.id);
                  router.refresh();
                })
              }
            >
              <Trash2 />
            </IconButton>
          </ListRow>
        ))}
        {rows.length === 0 && <ListEmpty>Nothing is blocked.</ListEmpty>}
      </List>
    </Panel>
  );
}
