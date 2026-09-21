"use client";

import {
  ConfirmDialog,
  IconButton,
  List,
  ListEmpty,
  ListRow,
  Panel,
  StatusPill,
} from "@/components/kit";
import { removeSuppressionAction } from "@/server/actions";
import { ShieldOff, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface Row {
  id: string;
  address: string;
  reason: string;
  createdAt: Date;
}

export function SuppressionPanel({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [unblocking, setUnblocking] = useState<Row | null>(null);

  return (
    <Panel
      title="Suppression list"
      description="Added automatically after a hard bounce or a spam complaint. Sending to these is refused."
      meta={`${rows.length}`}
    >
      {/* Unblocking is not undoing a mistake, usually. The address is here
          because mail to it bounced or somebody reported it, and sending
          again is what puts the account's own reputation at risk. */}
      <ConfirmDialog
        open={unblocking !== null}
        onOpenChange={(next) => !next && setUnblocking(null)}
        title="Send to this address again?"
        description={unblocking?.address}
        consequences={
          unblocking?.reason === "complaint"
            ? "Somebody at this address reported your mail as spam. Sending again is what mailbox providers count against the whole account."
            : "Mail to this address bounced for good. Sending again is counted against the account's bounce rate, and SES suspends accounts above five per cent."
        }
        confirmLabel="Unblock"
        onConfirm={async () => {
          if (!unblocking) return;
          await removeSuppressionAction(unblocking.id);
          setUnblocking(null);
          toast.success("Unblocked");
          router.refresh();
        }}
      />

      <List>
        {rows.map((row) => (
          <ListRow key={row.id}>
            <ShieldOff className="size-4 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{row.address}</span>
            <StatusPill state="bad">{row.reason}</StatusPill>
            <span className="text-[12px] text-muted-foreground">
              {row.createdAt.toLocaleDateString()}
            </span>
            <IconButton label={`Unblock ${row.address}`} onClick={() => setUnblocking(row)}>
              <Trash2 />
            </IconButton>
          </ListRow>
        ))}
        {rows.length === 0 && <ListEmpty>Nothing is blocked.</ListEmpty>}
      </List>
    </Panel>
  );
}
