import { Badge } from "@/components/kit";
import { Empty, Row, Surface } from "@/components/mail/page-frame";
import type { CampaignsOverview } from "@/server/campaigns";
import { Megaphone, Workflow, Zap } from "lucide-react";
import Link from "next/link";

/**
 * The first thing the campaigns side shows.
 *
 * Numbers and the last few sends. Deliberately not a chart: an instance that
 * has sent two broadcasts has nothing to plot, and an empty chart reads as
 * something being broken rather than as something not having happened yet.
 *
 * Two rows, because they answer two questions. The first is how the audience
 * and the last sends did. The second is whether there will be a next send at
 * all — a complaint rate over a few tenths of a per cent is what stops Gmail
 * accepting your mail, and it is not a thing anybody thinks to go looking for
 * on a screen of its own.
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

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Subscribers"
          value={overview.subscribers.toLocaleString()}
          hint={movement(overview.joined, overview.left)}
        />
        <Stat label="Lists" value={overview.lists.toLocaleString()} />
        <Stat
          label="Opened"
          value={overview.openRate === null ? "—" : `${overview.openRate}%`}
          hint={overview.openRate === null ? "Nothing sent yet" : "of everything sent"}
        />
        <Stat
          label="Clicked"
          value={overview.clickRate === null ? "—" : `${overview.clickRate}%`}
          hint={
            overview.clickRate === null
              ? "Nothing sent yet"
              : overview.clickRate === 0
                ? "Needs click tracking on in SES"
                : "of everything sent"
          }
        />
      </div>

      {/* The health row. Kept apart from the first four because these are not
          about how a campaign did — they are about whether the next one is
          accepted at all. */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Bounced"
          value={overview.bounceRate === null ? "—" : `${overview.bounceRate}%`}
          hint="Over 2% gets an SES account reviewed"
          tone={tone(overview.bounceRate, 2, 5)}
        />
        <Stat
          label="Complaints"
          value={overview.complaintRate === null ? "—" : `${overview.complaintRate}%`}
          hint="Gmail wants this under 0.3%"
          tone={tone(overview.complaintRate, 0.1, 0.3)}
        />
        <Stat
          label="Automations"
          value={overview.automationsLive.toLocaleString()}
          hint={
            overview.inFlight > 0
              ? `${overview.inFlight.toLocaleString()} part-way through`
              : overview.automationsLive === 0
                ? "None switched on"
                : "Nobody in one yet"
          }
          icon={<Workflow />}
          href="/campaigns/automations"
        />
        <Stat
          label="Events"
          value={overview.eventNames.toLocaleString()}
          hint={
            overview.eventNames === 0
              ? "None declared"
              : `${overview.eventsSeen.toLocaleString()} received`
          }
          icon={<Zap />}
          href="/campaigns/events"
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
            hint="Make a list, then write your first campaign. It is saved as a draft until you send it."
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

/** Which way the audience moved, in the words it takes to say it. */
function movement(joined: number, left: number) {
  if (joined === 0 && left === 0) return "No change in 30 days";
  const parts: string[] = [];
  if (joined > 0) parts.push(`+${joined.toLocaleString()}`);
  if (left > 0) parts.push(`−${left.toLocaleString()}`);
  return `${parts.join(" ")} in 30 days`;
}

/**
 * A rate read against what a mailbox provider will put up with.
 *
 * Grey until there is something to worry about. Colouring a healthy number
 * green trains people to ignore the colour, which is the one thing it has to
 * survive to be worth having when it turns red.
 */
function tone(rate: number | null, warn: number, bad: number) {
  if (rate === null) return undefined;
  if (rate >= bad) return "danger" as const;
  if (rate >= warn) return "warn" as const;
  return undefined;
}

function Stat({
  label,
  value,
  hint,
  tone: level,
  icon,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn" | "danger";
  icon?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {icon ? <span className="[&_svg]:size-3.5">{icon}</span> : null}
        {label}
      </div>
      <div
        className={`mt-1 font-display text-[24px] font-semibold tracking-[-0.025em] tabular-nums ${
          level === "danger" ? "text-destructive" : level === "warn" ? "text-warn" : ""
        }`}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</div> : null}
    </>
  );

  const skin = `rounded-2xl border bg-card px-4 py-3.5 ${
    level === "danger"
      ? "border-destructive/40"
      : level === "warn"
        ? "border-warn/40"
        : "border-border"
  }`;

  return href ? (
    <Link href={href} className={`${skin} block transition-colors hover:bg-muted/40`}>
      {body}
    </Link>
  ) : (
    <div className={skin}>{body}</div>
  );
}
