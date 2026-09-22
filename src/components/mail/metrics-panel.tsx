"use client";

import {
  BlankSlate,
  Card,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/kit";
import { type BounceKind, type DayBucket, type MetricsView, RANGES } from "@/lib/metrics-view";
import { cn } from "@/lib/utils";
import { Activity } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Where sending stands, as a shape rather than a list.
 *
 * The thresholds are Amazon's, not ours: SES puts an account under review at
 * a 5% bounce rate and at 0.1% complaints, and suspends above them. They are
 * drawn on the charts because a 3% bounce rate means nothing on its own and
 * everything next to the line it is approaching.
 */
const BOUNCE_RISK = 5;
const COMPLAINT_RISK = 0.1;

const ALL = "__all__";

export function MetricsPanel({ view }: { view: MetricsView }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function set(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    start(() => router.push(`${path}?${next}`, { scroll: false }));
  }

  const filters = (
    <div className="flex items-center gap-2">
      {view.domains.length > 1 && (
        <Select
          value={view.domainId ?? ALL}
          onValueChange={(value) => set({ domain: value === ALL ? null : value })}
        >
          <SelectTrigger size="sm" className="w-[150px] text-[12.5px]" aria-label="Domain">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All domains</SelectItem>
            {view.domains.map((entry) => (
              <SelectItem key={entry.id} value={entry.id} className="font-mono">
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={String(view.range)} onValueChange={(value) => set({ range: value })}>
        <SelectTrigger size="sm" className="w-[130px] text-[12.5px]" aria-label="How far back">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGES.map((days) => (
            <SelectItem key={days} value={String(days)}>
              Last {days} days
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Panel
      title="Metrics"
      description="What this account has sent, and how much of it arrived."
      action={filters}
    >
      <div className={cn("space-y-4 transition-opacity", pending && "opacity-60")}>
        {view.totals.sent === 0 ? (
          /* Charts of nothing read as something being broken rather than as
             something not having happened yet. */
          <BlankSlate
            icon={<Activity />}
            title="Nothing sent in this window"
            hint="Send something, or widen the range. Test sends are left out — they never reach SES, so they would make every rate here a rate of something that did not happen."
          />
        ) : (
          <>
            <Card className="p-5">
              <div className="mb-5 flex flex-wrap items-start gap-x-10 gap-y-4">
                <Figure label="Emails" value={view.totals.sent.toLocaleString()} />
                <Figure label="Delivered" value={percent(view.deliverability)} />
                <Figure
                  label="Opened"
                  value={percent(view.openRate)}
                  hint="of what was delivered"
                />
              </div>
              <Volume days={view.days} />
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <RateCard
                label="Bounce rate"
                rate={view.bounceRate}
                risk={BOUNCE_RISK}
                days={view.days}
                pick={(day) => day.bounced}
                breakdown={view.bounces}
                sent={view.totals.sent}
                note="Mail SES could not deliver. Above 5% Amazon puts the account under review."
              />
              <RateCard
                label="Complaint rate"
                rate={view.complaintRate}
                risk={COMPLAINT_RISK}
                days={view.days}
                pick={(day) => day.complained}
                breakdown={view.complaints}
                sent={view.totals.sent}
                note="People who pressed the spam button. Above 0.1% Amazon puts the account under review."
              />
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function percent(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

/** A number and what it counts, in that order. */
function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger";
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          "mt-1 font-display text-[30px] leading-none tracking-[-0.03em] tabular-nums",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Every date on the axis is unreadable past a fortnight; every third is not. */
function axisLabels(days: DayBucket[]) {
  const step = Math.max(1, Math.ceil(days.length / 6));
  return days.map((day, index) => (index % step === 0 ? shortDate(day.day) : ""));
}

function shortDate(day: string) {
  const [, month, date] = day.split("-");
  return new Date(Date.UTC(2000, Number(month) - 1, Number(date))).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** How much went out each day. Bars, because a day is a bucket, not a point. */
function Volume({ days }: { days: DayBucket[] }) {
  const peak = Math.max(1, ...days.map((day) => day.sent));
  const labels = axisLabels(days);

  return (
    <div>
      <div className="flex h-44 items-end gap-[3px]">
        {days.map((day) => (
          <div
            key={day.day}
            className="group flex h-full flex-1 items-end"
            title={`${shortDate(day.day)} — ${day.sent.toLocaleString()} sent, ${day.bounced.toLocaleString()} bounced`}
          >
            <div className="flex w-full flex-col justify-end" style={{ height: "100%" }}>
              {/* Bounces sit on top of the bar rather than beside it: they are
                  a part of what was sent, not a second thing that happened. */}
              <div
                className="w-full rounded-t-[3px] bg-destructive/70"
                style={{ height: `${(day.bounced / peak) * 100}%` }}
              />
              <div
                className={cn(
                  "w-full bg-primary/75 transition-colors group-hover:bg-primary",
                  day.bounced === 0 && "rounded-t-[3px]",
                )}
                style={{ height: `${((day.sent - day.bounced) / peak) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex gap-[3px] border-border border-t pt-2">
        {days.map((day, index) => (
          <span
            key={day.day}
            className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground"
          >
            {labels[index]}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * One rate over time, against the line it must not cross.
 *
 * A stroke that scales with the box would thin out on a wide screen, so the
 * viewBox is stretched and the stroke is told not to follow it.
 */
function RateCard({
  label,
  rate,
  risk,
  days,
  pick,
  breakdown,
  sent,
  note,
}: {
  label: string;
  rate: number | null;
  risk: number;
  days: DayBucket[];
  pick: (day: DayBucket) => number;
  breakdown: BounceKind[];
  sent: number;
  note: string;
}) {
  const series = days.map((day) => (day.sent > 0 ? (pick(day) / day.sent) * 100 : 0));
  // The ceiling is the threshold unless the rate has gone past it, so the
  // risk line keeps the same place on the card from one day to the next.
  const ceiling = Math.max(risk * 1.25, ...series.map((value) => value * 1.2));
  const over = rate !== null && rate >= risk;

  const width = 300;
  const height = 110;
  const x = (index: number) =>
    days.length === 1 ? width / 2 : (index / (days.length - 1)) * width;
  const y = (value: number) => height - (value / ceiling) * height;
  const line = series.map((value, index) => `${x(index)},${y(value)}`).join(" ");

  return (
    <Card className="flex flex-col p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <Figure label={label} value={percent(rate)} tone={over ? "danger" : undefined} />
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-[130px] w-full"
          role="img"
          aria-label={`${label} over the last ${days.length} days`}
        >
          <title>{`${label} over the last ${days.length} days`}</title>

          {[0.25, 0.5, 0.75].map((at) => (
            <line
              key={at}
              x1="0"
              x2={width}
              y1={height * at}
              y2={height * at}
              className="stroke-border"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <line
            x1="0"
            x2={width}
            y1={y(risk)}
            y2={y(risk)}
            className="stroke-destructive/70"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />

          <polyline
            points={line}
            fill="none"
            strokeWidth="1.75"
            className={cn(over ? "stroke-destructive" : "stroke-primary")}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <span
          className="pointer-events-none absolute left-0 text-[10px] font-medium tracking-wide text-destructive"
          style={{ top: `${(y(risk) / height) * 130 + 2}px` }}
        >
          RISK {risk}%
        </span>
      </div>

      <div className="mt-2 flex justify-between border-border border-t pt-2 text-[10.5px] text-muted-foreground">
        <span>{shortDate(days[0]!.day)}</span>
        <span>{shortDate(days.at(-1)!.day)}</span>
      </div>

      {breakdown.length > 0 ? (
        <div className="mt-3 divide-y divide-border border-border border-t">
          {breakdown.map((row) => (
            <div key={row.kind} className="flex items-center gap-3 py-2 text-[12.5px]">
              <span className="size-1.5 shrink-0 rounded-full bg-destructive/70" />
              <span className="min-w-0 flex-1 truncate">{row.kind}</span>
              <span className="tabular-nums text-muted-foreground">
                {row.howMany.toLocaleString()}
              </span>
              <span className="w-12 text-right tabular-nums">{row.rate}%</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 border-border border-t pt-3 text-[12.5px] text-muted-foreground">
          None in {sent.toLocaleString()} sent.
        </p>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">{note}</p>
    </Card>
  );
}
