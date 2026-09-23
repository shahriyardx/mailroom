"use client";

import {
  Badge,
  Button,
  ConfirmDialog,
  IconButton,
  Input,
  List,
  ListEmpty,
  ListRow,
  Note,
  Panel,
} from "@/components/kit";
import { sectionBase } from "@/lib/section";
import { cn } from "@/lib/utils";
import { removeSuppressionAction } from "@/server/actions";
import { MailX, Search, ShieldOff, Siren, Trash2 } from "lucide-react";
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

export type Kind = "all" | "bounce" | "complaint" | "manual";

/**
 * The two ways an address gets on this list do not mean the same thing.
 *
 * A bounce is an address that does not work. A complaint is a person who
 * pressed the spam button, and it is the one that costs the account its
 * reputation — so it is the one drawn in red, and the bounce beside it in
 * amber. Two red pills would have said they were the same problem.
 */
const KINDS: { key: Kind; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "bounce", label: "Bounces" },
  { key: "complaint", label: "Complaints" },
  { key: "manual", label: "Added by hand" },
];

/** Which of them a row's free-text reason is. */
function kindOf(reason: string): Exclude<Kind, "all"> {
  const value = reason.toLowerCase();
  if (value.includes("complaint")) return "complaint";
  if (value.includes("bounce")) return "bounce";
  return "manual";
}

const LOOK: Record<
  Exclude<Kind, "all">,
  { tone: "neutral" | "warn" | "danger"; icon: typeof ShieldOff; colour: string }
> = {
  complaint: { tone: "danger", icon: Siren, colour: "text-destructive" },
  bounce: { tone: "warn", icon: MailX, colour: "text-warn" },
  manual: { tone: "neutral", icon: ShieldOff, colour: "text-muted-foreground" },
};

interface Props {
  rows: Row[];
  query: string;
  kind: Kind;
  /** How many rows the current search matches, not how many are on this page. */
  matching: number;
  total: number;
  counts: Record<Kind, number>;
  page: number;
  pageCount: number;
}

export function SuppressionPanel({
  rows,
  query,
  kind,
  matching,
  total,
  counts,
  page,
  pageCount,
}: Props) {
  const router = useRouter();
  const base = sectionBase(usePathname());
  const [unblocking, setUnblocking] = useState<Row | null>(null);

  /*
   * Every link here keeps the other two controls.
   *
   * Changing the filter and silently losing the search — or the other way
   * round — is how a list starts showing something nobody asked for. The page
   * number is the one thing that does not survive a change of filter, because
   * page four of a different list is not page four of this one.
   */
  const href = (next: { kind?: Kind; page?: number }) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    const wanted = next.kind ?? kind;
    if (wanted !== "all") params.set("reason", wanted);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const search = params.toString();
    return search ? `${base}/blocked?${search}` : `${base}/blocked`;
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
          unblocking && kindOf(unblocking.reason) === "complaint"
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
      <form method="get" className="mb-3 flex items-center gap-2">
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
        {/* The filter travels with the search rather than being reset by it. */}
        {kind !== "all" && <input type="hidden" name="reason" value={kind} />}
        <Button type="submit" variant="outline">
          Search
        </Button>
        {query && (
          <Button type="button" variant="ghost" onClick={() => router.push(href({ page: 1 }))}>
            Clear
          </Button>
        )}
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {KINDS.map((entry) => {
          const active = entry.key === kind;
          return (
            <Link
              key={entry.key}
              href={href({ kind: entry.key, page: 1 })}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors",
                active
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {entry.label}
              <span
                className={cn(
                  "font-mono text-[11px] tabular-nums",
                  active ? "text-primary-foreground/75" : "text-muted-foreground/70",
                )}
              >
                {counts[entry.key]}
              </span>
            </Link>
          );
        })}
      </div>

      <List>
        {rows.map((row) => {
          const look = LOOK[kindOf(row.reason)];
          return (
            <ListRow key={row.id}>
              <look.icon className={cn("size-4 shrink-0", look.colour)} />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{row.address}</span>
              {/* The reason as SES gave it, which is often longer than the
                  word the filter sorted it under and worth reading. */}
              <Badge size="sm" tone={look.tone} className="max-w-[220px] truncate">
                {row.reason}
              </Badge>
              <span className="text-[12px] text-muted-foreground">
                {row.createdAt.toLocaleDateString()}
              </span>
              <IconButton label={`Unblock ${row.address}`} onClick={() => setUnblocking(row)}>
                <Trash2 />
              </IconButton>
            </ListRow>
          );
        })}
        {rows.length === 0 && (
          <ListEmpty>{query ? `Nothing blocked matches “${query}”.` : "Nothing here."}</ListEmpty>
        )}
      </List>

      {matching > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Note>
            {query || kind !== "all"
              ? `${matching} of ${total} blocked ${total === 1 ? "address" : "addresses"} shown.`
              : `${total} blocked ${total === 1 ? "address" : "addresses"}.`}
            {pageCount > 1 && ` Page ${page} of ${pageCount}.`}
          </Note>

          {pageCount > 1 && (
            <span className="flex items-center gap-2">
              {page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={href({ page: page - 1 })}>Previous</Link>
                </Button>
              )}
              {page < pageCount && (
                <Button asChild variant="outline" size="sm">
                  <Link href={href({ page: page + 1 })}>Next</Link>
                </Button>
              )}
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}
