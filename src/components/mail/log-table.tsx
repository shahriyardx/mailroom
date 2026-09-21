"use client";

import {
  Badge,
  BlankSlate,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/kit";
import { cn } from "@/lib/utils";
import { DAY_RANGES, type Direction, type LogRow, SENDING_STATUSES } from "@/server/logs";
import { Inbox, Search, Send } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

interface Props {
  rows: LogRow[];
  direction: Direction;
  keys: { id: string; name: string; mode: string }[];
  nextCursor: string | null;
}

const TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  delivered: "ok",
  sent: "neutral",
  queued: "neutral",
  canceled: "neutral",
  delayed: "warn",
  bounced: "danger",
  complained: "danger",
  rejected: "danger",
  failed: "danger",
};

export function LogTable({ rows, direction, keys, nextCursor }: Props) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  // Typing should not put a request in flight per keystroke, and should not
  // lose what was typed when the server answers either.
  const [query, setQuery] = useState(params.get("q") ?? "");
  useEffect(() => setQuery(params.get("q") ?? ""), [params]);

  function set(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    // Any change to the filters invalidates where we were in the list.
    next.delete("cursor");
    start(() => router.push(`${path}?${next}`, { scroll: false }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={direction} onValueChange={(value) => set({ direction: value })}>
          <TabsList>
            <TabsTrigger value="sending">
              <Send />
              Sending
            </TabsTrigger>
            <TabsTrigger value="receiving">
              <Inbox />
              Receiving
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-0 flex-1 md:max-w-xs"
          onSubmit={(event) => {
            event.preventDefault();
            set({ q: query });
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Address, subject or SES id"
            aria-label="Search the log"
            className="pl-9"
          />
        </form>

        <Select value={params.get("days") ?? "15"} onValueChange={(value) => set({ days: value })}>
          <SelectTrigger className="w-auto min-w-[9.5rem]" aria-label="Date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAY_RANGES.map((range) => (
              <SelectItem key={range.value} value={range.value}>
                {range.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {direction === "sending" && (
          <>
            <Select
              value={params.get("status") ?? "all"}
              onValueChange={(value) => set({ status: value === "all" ? null : value })}
            >
              <SelectTrigger className="w-auto min-w-[8.5rem]" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {SENDING_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {keys.length > 0 && (
              <Select
                value={params.get("key") ?? "all"}
                onValueChange={(value) => set({ key: value === "all" ? null : value })}
              >
                <SelectTrigger className="w-auto min-w-[9rem]" aria-label="API key">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All API keys</SelectItem>
                  {keys.map((key) => (
                    <SelectItem key={key.id} value={key.id}>
                      {key.name}
                      {key.mode === "test" ? " (test)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              variant={params.get("test") === "1" ? "solid" : "outline"}
              size="sm"
              pill
              onClick={() => set({ test: params.get("test") === "1" ? null : "1" })}
            >
              Test sends
            </Button>
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <BlankSlate
          icon={direction === "sending" ? <Send /> : <Inbox />}
          title={direction === "sending" ? "No sends match" : "Nothing received"}
          hint={
            params.toString()
              ? "Widen the date range, or clear the filters."
              : "Every message this account sends will be listed here with what happened to it."
          }
        />
      ) : (
        <div
          className={cn("overflow-hidden rounded-xl border border-border", pending && "opacity-60")}
        >
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="border-border border-b bg-muted/40 text-[11.5px] text-muted-foreground">
                <th className="w-[34%] px-3 py-2 text-left font-medium">
                  {direction === "sending" ? "To" : "From"}
                </th>
                <th className="hidden w-[15%] px-3 py-2 text-left font-medium sm:table-cell">
                  Status
                </th>
                <th className="px-3 py-2 text-left font-medium">Subject</th>
                <th className="w-[16%] px-3 py-2 text-right font-medium">
                  {direction === "sending" ? "Sent" : "Received"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <Row key={row.id} row={row} direction={direction} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            pill
            loading={pending}
            onClick={() => set({ cursor: nextCursor })}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ row, direction }: { row: LogRow; direction: Direction }) {
  const who =
    direction === "sending" ? (row.to[0]?.address ?? "—") : (row.fromName ?? row.fromAddress);
  const extra = direction === "sending" && row.to.length > 1 ? ` +${row.to.length - 1}` : "";

  return (
    <tr className="group transition-colors hover:bg-accent/50">
      <td className="px-3 py-2.5">
        <Link href={`/settings/logs/${row.id}`} className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: row.mailboxColor }}
            title={row.mailbox}
          />
          <span className="truncate text-[13px] group-hover:underline">{who}</span>
          {extra && <span className="shrink-0 text-[12px] text-muted-foreground">{extra}</span>}
          {row.isTest && (
            <Badge size="sm" tone="outline">
              test
            </Badge>
          )}
        </Link>
      </td>
      <td className="hidden px-3 py-2.5 sm:table-cell">
        {row.deliveryStatus ? (
          <Badge
            size="sm"
            tone={TONE[row.deliveryStatus] ?? "neutral"}
            title={row.deliveryError ?? undefined}
          >
            {row.deliveryStatus}
          </Badge>
        ) : (
          <span className="text-[12px] text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <Link
          href={`/settings/logs/${row.id}`}
          className="block truncate text-[13px] text-muted-foreground"
        >
          {row.subject || "(no subject)"}
        </Link>
      </td>
      <td className="px-3 py-2.5 text-right text-[12px] text-muted-foreground tabular-nums">
        <time dateTime={new Date(row.at).toISOString()} title={new Date(row.at).toLocaleString()}>
          {ago(new Date(row.at))}
        </time>
      </td>
    </tr>
  );
}

/** Short enough for a column that is mostly read at a glance. */
function ago(at: Date) {
  const seconds = Math.round((Date.now() - at.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return at.toLocaleDateString();
}
