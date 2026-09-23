"use client";

import {
  Button,
  ConfirmDialog,
  IconButton,
  Input,
  List,
  ListEmpty,
  ListRow,
  Note,
  Panel,
  StatusPill,
} from "@/components/kit";
import { sectionBase } from "@/lib/section";
import { removeSuppressionAction } from "@/server/actions";
import { Search, ShieldOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface Row {
  id: string;
  address: string;
  reason: string;
  createdAt: Date;
}

interface Props {
  rows: Row[];
  query: string;
  /** How many rows the current search matches, not how many are on this page. */
  matching: number;
  total: number;
  page: number;
  pageCount: number;
}

export function SuppressionPanel({ rows, query, matching, total, page, pageCount }: Props) {
  const router = useRouter();
  const base = sectionBase(usePathname());
  const [unblocking, setUnblocking] = useState<Row | null>(null);

  const href = (next: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (next > 1) params.set("page", String(next));
    const search = params.toString();
    return search ? `/settings/blocked?${search}` : "/settings/blocked";
  };

  return (
    <Panel
      title="Blocklist"
      description="Added automatically after a hard bounce or a spam complaint. Sending to these is refused."
      meta={`${total}`}
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

      {/* Whether one address is on this list is the question people come here
          with, and scrolling a few thousand rows is not an answer to it. */}
      <form method="get" className="mb-4 flex items-center gap-2">
        <span className="relative flex-1">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-3.5 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={query}
            mono
            placeholder="Search a blocked address"
            aria-label="Search blocked addresses"
            className="pl-9"
          />
        </span>
        <Button type="submit" variant="outline">
          Search
        </Button>
        {query && (
          <Button type="button" variant="ghost" onClick={() => router.push(`${base}/blocked`)}>
            Clear
          </Button>
        )}
      </form>

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
        {rows.length === 0 && (
          <ListEmpty>
            {query ? `Nothing blocked matches “${query}”.` : "Nothing is blocked."}
          </ListEmpty>
        )}
      </List>

      {matching > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Note>
            {query
              ? `${matching} of ${total} blocked ${total === 1 ? "address" : "addresses"} match.`
              : `${total} blocked ${total === 1 ? "address" : "addresses"}.`}
            {pageCount > 1 && ` Page ${page} of ${pageCount}.`}
          </Note>

          {pageCount > 1 && (
            <span className="flex items-center gap-2">
              {page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={href(page - 1)}>Previous</Link>
                </Button>
              )}
              {page < pageCount && (
                <Button asChild variant="outline" size="sm">
                  <Link href={href(page + 1)}>Next</Link>
                </Button>
              )}
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}
