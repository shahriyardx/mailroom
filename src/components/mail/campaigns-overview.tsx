import { Badge } from "@/components/kit";
import { Empty, Row, Surface } from "@/components/mail/page-frame";
import type { CampaignsOverview } from "@/server/campaigns";
import { Megaphone } from "lucide-react";
import Link from "next/link";

/**
 * The first thing the campaigns side shows.
 *
 * Four numbers and the last few sends. Deliberately not a chart: an instance
 * that has sent two broadcasts has nothing to plot, and an empty chart reads
 * as something being broken rather than as something not having happened yet.
 */
export function CampaignsOverviewPanel({ overview }: { overview: CampaignsOverview }) {
  return (
    <>
      <div className="mb-5">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.025em]">Overview</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Where your lists and your sending stand.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Subscribers" value={overview.subscribers.toLocaleString()} />
        <Stat label="Lists" value={overview.lists.toLocaleString()} />
        <Stat label="Delivered" value={overview.delivered.toLocaleString()} />
        <Stat
          label="Opened"
          value={overview.openRate === null ? "—" : `${overview.openRate}%`}
          hint={overview.openRate === null ? "Nothing sent yet" : "of everything delivered"}
        />
      </div>

      {overview.unsubscribed > 0 ? (
        <p className="mb-4 text-[12px] text-muted-foreground">
          {overview.unsubscribed.toLocaleString()} unsubscribed. They stay on the list, marked, so a
          later import cannot add them back.
        </p>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-[15px] font-semibold tracking-[-0.02em]">
          Recent broadcasts
        </h2>
        {overview.recent.length > 0 ? (
          <Link href="/campaigns/broadcasts" className="text-[12.5px] text-primary hover:underline">
            See all
          </Link>
        ) : null}
      </div>

      <Surface>
        {overview.recent.length === 0 ? (
          <Empty
            icon={<Megaphone />}
            title="Nothing sent yet"
            hint="Make a list, then write your first broadcast. It is saved as a draft until you send it."
          />
        ) : (
          overview.recent.map((entry) => (
            <Row key={entry.id}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-4">
                <Megaphone />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium">{entry.subject}</span>
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
                <div className="mt-0.5 text-[12px] text-muted-foreground">
                  {entry.listName}
                  {entry.total > 0 ? ` · ${entry.sent} of ${entry.total} sent` : ""}
                </div>
              </div>
            </Row>
          ))
        )}
      </Surface>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3.5">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-[24px] font-semibold tracking-[-0.025em] tabular-nums">
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
