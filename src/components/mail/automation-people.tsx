"use client";

import { Badge, BlankSlate, Button, ConfirmDialog, IconButton, Input } from "@/components/kit";
import type { AutomationNodeKind } from "@/db/schema";
import { onThe } from "@/lib/automation-flow";
import { cn } from "@/lib/utils";
import { stopRunAction } from "@/server/actions";
import type { PersonInFlow } from "@/server/automations";
import { ArrowLeft, ChevronDown, LogOut, Search, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/** Rows a page shows. The server pages by the same number. */
const PAGE = 50;

const TABS = [
  { key: null, label: "Everybody" },
  { key: "active", label: "Part-way" },
  { key: "done", label: "Finished" },
  { key: "stopped", label: "Stopped" },
] as const;

const LOOK = {
  active: { tone: "accent", label: "Part-way" },
  done: { tone: "ok", label: "Finished" },
  stopped: { tone: "neutral", label: "Stopped" },
} as const;

interface Filter {
  status: "active" | "done" | "stopped" | null;
  nodeId: string | null;
  q: string;
  page: number;
}

/**
 * Who is in one automation.
 *
 * The count on the canvas says how many people are on a box. This says who
 * they are, how far each got, what the flow sent them and what came back —
 * and why anybody stopped, which is the question after "why did they not
 * get the second email".
 */
export function AutomationPeople({
  automationId,
  name,
  people,
  total,
  counts,
  boxes,
  filter,
}: {
  automationId: string;
  name: string;
  people: PersonInFlow[];
  total: number;
  counts: Record<string, number>;
  /** What each box is called on the canvas, by node id. */
  boxes: Record<string, { kind: AutomationNodeKind; title: string }>;
  filter: Filter;
}) {
  const router = useRouter();
  const path = usePathname();
  const [search, setSearch] = useState(filter.q);
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PersonInFlow | null>(null);

  /** The same page with some of the filter changed. */
  function href(patch: Partial<Filter>) {
    const next = { ...filter, page: 0, ...patch };
    const query = new URLSearchParams();
    if (next.status) query.set("status", next.status);
    if (next.nodeId) query.set("node", next.nodeId);
    if (next.q.trim()) query.set("q", next.q.trim());
    if (next.page > 0) query.set("page", String(next.page));
    const text = query.toString();
    return text ? `${path}?${text}` : path;
  }

  const everybody = (counts.active ?? 0) + (counts.done ?? 0) + (counts.stopped ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="Take them out of this flow?"
        description={removing?.address}
        consequences="Nothing more is sent to them from this flow. They stay on the list, and they are not put back in if they join again."
        confirmLabel="Take them out"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await stopRunAction(automationId, removing.runId);
            setRemoving(null);
            toast.success("Taken out");
            router.refresh();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not take them out");
          }
        }}
      />

      <header className="flex h-14 shrink-0 items-center gap-3 border-border border-b px-4">
        <Link
          href={`/campaigns/automations/${automationId}`}
          className="flex shrink-0 items-center gap-1.5 font-medium text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {name}
        </Link>
        <span className="h-5 w-px bg-border" />
        <span className="font-medium text-[14px]">People</span>
        <span className="text-[12.5px] text-muted-foreground tabular-nums">{everybody}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <nav className="flex gap-1 rounded-full border border-border bg-card p-1">
              {TABS.map((tab) => {
                const howMany = tab.key ? (counts[tab.key] ?? 0) : everybody;
                return (
                  <Link
                    key={tab.label}
                    href={href({ status: tab.key })}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors",
                      filter.status === tab.key
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {tab.label}
                    <span className="font-mono text-[11px] tabular-nums opacity-80">{howMany}</span>
                  </Link>
                );
              })}
            </nav>

            <form
              className="ml-auto flex min-w-0 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                router.push(href({ q: search }));
              }}
            >
              <span className="relative">
                <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find an address"
                  className="w-[220px] pl-8"
                />
              </span>
            </form>
          </div>

          {filter.nodeId && (
            <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              Only people on
              <Badge tone="outline">{boxes[filter.nodeId]?.title ?? "one box"}</Badge>
              <Link
                href={href({ nodeId: null })}
                className="flex items-center gap-1 hover:text-foreground"
              >
                <X className="size-3.5" />
                Show every box
              </Link>
            </p>
          )}

          {people.length === 0 ? (
            <BlankSlate
              icon={<Users />}
              title={everybody === 0 ? "Nobody has been through it yet" : "Nobody matches"}
              hint={
                everybody === 0
                  ? "People appear here the moment the flow puts them in."
                  : "Try another tab, or clear the search."
              }
            />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {people.map((person) => {
                const look = LOOK[person.status];
                const box = person.nodeId ? boxes[person.nodeId] : undefined;
                const expanded = open === person.runId;
                return (
                  <li key={person.runId}>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={expanded ? "Hide what it sent" : "Show what it sent"}
                        onClick={() => setOpen(expanded ? null : person.runId)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
                      >
                        <ChevronDown
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            !expanded && "-rotate-90",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-[13px]">
                            {person.name ? `${person.name} · ` : ""}
                            {person.address}
                          </span>
                          <span className="block truncate text-[12px] text-muted-foreground">
                            {where(person, box)}
                          </span>
                        </span>
                      </button>

                      <span className="hidden shrink-0 text-right text-[11.5px] text-muted-foreground tabular-nums sm:block">
                        {person.sends.length} sent
                        <br />
                        since {onThe(new Date(person.startedAt))}
                      </span>
                      <Badge size="sm" tone={look.tone} className="shrink-0">
                        {look.label}
                      </Badge>
                      {person.status === "active" ? (
                        <IconButton
                          variant="danger"
                          label={`Take ${person.address} out of this flow`}
                          onClick={() => setRemoving(person)}
                        >
                          <LogOut />
                        </IconButton>
                      ) : (
                        <span className="size-8 shrink-0" />
                      )}
                    </div>

                    {expanded && (
                      <div className="space-y-1.5 border-border border-t bg-muted/30 px-10 py-2.5">
                        {person.sends.length === 0 ? (
                          <p className="text-[12px] text-muted-foreground">
                            Nothing sent to them yet.
                          </p>
                        ) : (
                          person.sends.map((send) => (
                            <p
                              key={`${send.nodeId}-${String(send.sentAt)}`}
                              className="flex items-center gap-2 text-[12.5px]"
                            >
                              <span className="w-28 shrink-0 text-muted-foreground tabular-nums">
                                {onThe(new Date(send.sentAt))}
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {send.subject || "No subject"}
                              </span>
                              {send.clicked ? (
                                <Badge size="sm" tone="ok">
                                  Clicked
                                </Badge>
                              ) : send.opened ? (
                                <Badge size="sm" tone="info">
                                  Opened
                                </Badge>
                              ) : (
                                <Badge size="sm">Not opened</Badge>
                              )}
                            </p>
                          ))
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-between text-[12.5px] text-muted-foreground">
              <span className="tabular-nums">
                Page {filter.page + 1} of {pages}
              </span>
              <span className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filter.page === 0}
                  onClick={() => router.push(href({ page: filter.page - 1 }))}
                >
                  Newer
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filter.page + 1 >= pages}
                  onClick={() => router.push(href({ page: filter.page + 1 }))}
                >
                  Older
                </Button>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Where somebody is, or how it ended, in one line. */
function where(person: PersonInFlow, box: { kind: AutomationNodeKind; title: string } | undefined) {
  if (person.status === "done") return "Reached the end";
  if (person.status === "stopped") return person.reason ?? "Stopped";

  const due = new Date(person.nextAt);
  const later = due.getTime() > Date.now();
  if (!box) return later ? `Moving on ${onThe(due)}` : "Moving on now";

  if (person.parked) {
    return box.kind === "await"
      ? `${box.title}, until ${onThe(due)} at the latest`
      : `Waiting (${box.title}) until ${onThe(due)}`;
  }
  if (person.attempts > 0) {
    return `${box.title}: failed ${person.attempts}× — ${person.reason ?? "will try again"}. Next try ${onThe(due)}`;
  }
  return later ? `${box.title}, held until ${onThe(due)}` : `${box.title}, due now`;
}
