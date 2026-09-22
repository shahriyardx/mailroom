import { Badge, BlankSlate, Panel } from "@/components/kit";
import type { CampaignsOverview } from "@/server/campaigns";
import { Megaphone } from "lucide-react";
import Link from "next/link";

/**
 * The first thing the campaigns side shows.
 *
 * Four numbers and the last few sends. Deliberately not a chart: an instance
 * that has sent two broadcasts has nothing to plot, and a chart of nothing is
 * worse than a number of nothing.
 */
export function CampaignsOverviewPanel({ overview }: { overview: CampaignsOverview }) {
  return (
    <>
      <Panel title="Overview" description="Where your lists and sends stand.">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat label="Subscribers" value={overview.subscribers.toLocaleString()} />
          <Stat label="Lists" value={overview.lists.toLocaleString()} />
          <Stat label="Delivered" value={overview.delivered.toLocaleString()} />
          <Stat
            label="Opened"
            value={overview.openRate === null ? "—" : `${overview.openRate}%`}
            hint={overview.openRate === null ? "Nothing sent yet" : undefined}
          />
        </div>

        {overview.unsubscribed > 0 ? (
          <p className="mt-3 text-[12px] text-muted-foreground">
            {overview.unsubscribed.toLocaleString()} unsubscribed. They stay on the list, marked, so
            a later import cannot add them back.
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Recent broadcasts"
        description="The last few, newest first."
        action={
          <Link href="/campaigns/broadcasts" className="text-[12.5px] text-primary hover:underline">
            All broadcasts
          </Link>
        }
      >
        {overview.recent.length === 0 ? (
          <BlankSlate
            icon={<Megaphone />}
            title="Nothing sent yet"
            hint="Make a list, then write your first broadcast."
          />
        ) : (
          <ul className="space-y-2">
            {overview.recent.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{entry.subject}</span>
                    <Badge
                      size="sm"
                      tone={
                        entry.status === "sent"
                          ? "ok"
                          : entry.status === "sending"
                            ? "warn"
                            : entry.status === "cancelled"
                              ? "danger"
                              : undefined
                      }
                    >
                      {entry.status}
                    </Badge>
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {entry.listName}
                    {entry.total > 0 ? ` · ${entry.sent} of ${entry.total} sent` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-[22px] font-semibold tracking-[-0.02em]">
        {value}
      </div>
      {hint ? <div className="text-[11.5px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
