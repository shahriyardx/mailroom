"use client";

import {
  Badge,
  Button,
  List,
  ListEmpty,
  ListRow,
  Meter,
  Note,
  Panel,
  Stat,
  Stats,
  StatusPill,
} from "@/components/kit";
import { formatCap, formatRate, readQuota } from "@/lib/quota";
import type { AccountStatus } from "@/lib/ses";
import { cn, formatBytes } from "@/lib/utils";
import type { Overview } from "@/server/analytics";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

interface Props {
  data: Overview;
  windowDays: number;
  account: AccountStatus | null;
}

export function OverviewPanel({ data, windowDays, account }: Props) {
  const { sending, receiving, storage, days, mailboxes, keys, api, counts } = data;
  const totalStorage = storage.attachmentBytes + storage.rawBytes;
  const quota = account ? readQuota(account) : null;

  return (
    <>
      <Panel
        title="Last 30 days"
        description="Everything this instance has sent and received in the rolling window."
      >
        <Stats>
          <Stat
            label="Sent"
            value={sending.sent.toLocaleString()}
            sub={`${api.sent} through the API`}
          />
          <Stat
            label="Received"
            value={receiving.received.toLocaleString()}
            sub={`${receiving.threads.toLocaleString()} conversations`}
          />
          <Stat
            label="Bounce rate"
            value={`${sending.bounceRate.toFixed(1)}%`}
            sub={`${sending.bounced} bounced`}
            tone={sending.bounceRate >= 5 ? "bad" : sending.bounceRate >= 2 ? "warn" : undefined}
          />
          <Stat
            label="Complaint rate"
            value={`${sending.complaintRate.toFixed(2)}%`}
            sub={`${sending.complained} marked as spam`}
            tone={
              sending.complaintRate >= 0.1
                ? "bad"
                : sending.complaintRate >= 0.05
                  ? "warn"
                  : undefined
            }
          />
        </Stats>

        <Activity days={days} className="mt-6" />

        {(sending.bounceRate >= 5 || sending.complaintRate >= 0.1) && (
          <Note className="mt-4 text-destructive">
            SES suspends accounts above a 5% bounce rate or a 0.1% complaint rate. Clean your lists
            before sending more.
          </Note>
        )}
      </Panel>

      <Panel
        title="Delivery"
        description={`What SES reported back about the ${sending.sent.toLocaleString()} messages sent in the window.`}
      >
        {sending.sent === 0 ? (
          <Note>Nothing sent yet.</Note>
        ) : (
          <>
            <Breakdown
              parts={[
                { label: "Delivered", value: sending.delivered, className: "bg-ok" },
                { label: "In flight", value: sending.pending, className: "bg-muted-foreground/40" },
                { label: "Bounced", value: sending.bounced, className: "bg-warn" },
                { label: "Complained", value: sending.complained, className: "bg-destructive" },
                { label: "Failed", value: sending.failed, className: "bg-destructive/60" },
              ]}
              total={sending.sent}
            />
            <Note className="mt-3">
              Anything stuck on "in flight" means the SNS subscription is not delivering events yet.
            </Note>
          </>
        )}
      </Panel>

      {account && quota && (
        <Panel
          title="SES account"
          description="Your sending quota, straight from Amazon."
          action={
            <StatusPill state={account.productionAccess ? "ok" : "pending"}>
              {account.productionAccess ? "Production access" : "Sandbox"}
            </StatusPill>
          }
        >
          <div className="max-w-lg">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display text-[22px] font-semibold tabular-nums">
                {quota.used.toLocaleString()}
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                of {formatCap(quota.cap)} in the last 24 hours
              </span>
            </div>
            {/* No bar when there is no cap: a meter that can never fill is a
                decoration pretending to be a reading. */}
            {quota.cap !== null && (
              <Meter
                className="mt-2"
                value={quota.used}
                max={quota.cap}
                tone={quota.tight ? "warn" : "accent"}
              />
            )}
            <Note className="mt-2">
              Up to {formatRate(quota.perSecond)} a second. Reputation is{" "}
              {account.enforcementStatus === "HEALTHY"
                ? "healthy"
                : account.enforcementStatus.toLowerCase()}
              .
            </Note>
            {/* People read this as a daily allowance and then look for the
                clock. There is no clock. */}
            <Note className="mt-1">
              This is a rolling 24 hours, not a daily allowance that resets. Each message stops
              counting against it 24 hours after it was sent.
            </Note>
          </div>
        </Panel>
      )}

      <Panel
        title="Storage"
        description="Attachments and raw messages kept in Cloudflare R2."
        meta={formatBytes(totalStorage)}
      >
        <Stats className="sm:grid-cols-3">
          <Stat
            label="Attachments"
            value={formatBytes(storage.attachmentBytes)}
            sub={`${storage.attachmentCount.toLocaleString()} files`}
          />
          <Stat
            label="Raw messages"
            value={formatBytes(storage.rawBytes)}
            sub={`${storage.rawCount.toLocaleString()} .eml files`}
          />
          <Stat label="Total" value={formatBytes(totalStorage)} sub="Across every mailbox" />
        </Stats>
      </Panel>

      <Panel
        title="Mailboxes"
        description="Traffic and stored bytes per address, over all time."
        meta={`${counts.mailboxes}`}
        action={
          <Button variant="ghost" size="sm" pill asChild>
            <Link href="/settings/mailboxes">
              Manage <ArrowRight />
            </Link>
          </Button>
        }
      >
        <List>
          {mailboxes.map((box) => (
            <ListRow key={box.id}>
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: box.color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{box.address}</span>
              <Column>{box.received.toLocaleString()} in</Column>
              <Column>{box.sent.toLocaleString()} out</Column>
              <Column className="w-20">{formatBytes(box.bytes)}</Column>
            </ListRow>
          ))}
          {mailboxes.length === 0 && <ListEmpty>No mailboxes yet.</ListEmpty>}
        </List>
      </Panel>

      <Panel
        title="API keys"
        description="Messages each key has sent in the window."
        meta={`${api.activeKeys} active`}
        action={
          <Button variant="ghost" size="sm" pill asChild>
            <Link href="/settings/api-keys">
              Manage <ArrowRight />
            </Link>
          </Button>
        }
      >
        <List>
          {keys.map((key) => (
            <ListRow key={key.id}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{key.name}</span>
                <span className="block truncate font-mono text-[12px] text-muted-foreground">
                  {key.prefix}
                </span>
              </span>
              {key.revoked && (
                <Badge size="sm" tone="danger">
                  Revoked
                </Badge>
              )}
              <Column className="w-28">
                {key.lastUsedAt ? `Used ${key.lastUsedAt.toLocaleDateString()}` : "Never used"}
              </Column>
              <Column className="w-16 text-foreground">{key.sent.toLocaleString()} sent</Column>
            </ListRow>
          ))}
          {keys.length === 0 && <ListEmpty>No API keys yet.</ListEmpty>}
        </List>
      </Panel>

      <Panel title="Setup" description="What this instance is wired up to.">
        <Stats className="sm:grid-cols-4">
          <Stat
            label="Domains verified"
            value={`${counts.verifiedDomains}/${counts.domains}`}
            sub="Sending enabled in SES"
          />
          <Stat label="Mailboxes" value={counts.mailboxes} sub="Addresses you own" />
          <Stat
            label="Blocked addresses"
            value={counts.blocked}
            sub="After bounces and complaints"
            tone={counts.blocked > 0 ? "warn" : undefined}
          />
          <Stat label="Unread" value={receiving.unread} sub={`In the last ${windowDays} days`} />
        </Stats>
      </Panel>
    </>
  );
}

/** A right-aligned column of a fixed width, so numbers line up down the list. */
function Column({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "w-16 shrink-0 text-right text-[12.5px] text-muted-foreground tabular-nums",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Sent and received per day. Two bars a day, no library. */
function Activity({
  days,
  className,
}: {
  days: Overview["days"];
  className?: string;
}) {
  const peak = Math.max(1, ...days.map((day) => Math.max(day.sent, day.received)));
  const busiest = days.reduce((sum, day) => sum + day.sent + day.received, 0);

  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-4 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" aria-hidden />
          Received
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/45" aria-hidden />
          Sent
        </span>
        <span className="ml-auto tabular-nums">{busiest.toLocaleString()} messages</span>
      </div>

      <div className="flex h-24 items-end gap-[3px]">
        {days.map((day) => (
          <div
            key={day.day}
            className="group flex h-full min-w-0 flex-1 items-end justify-center gap-[2px]"
            title={`${day.day}: ${day.received} in, ${day.sent} out`}
          >
            <Bar value={day.received} peak={peak} className="bg-primary" />
            <Bar value={day.sent} peak={peak} className="bg-muted-foreground/45" />
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>{formatDay(days[0]?.day)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Bar({ value, peak, className }: { value: number; peak: number; className: string }) {
  // A day with one message still has to be visible.
  const height = value === 0 ? 2 : Math.max(3, (value / peak) * 100);
  return (
    <span
      className={cn("w-full rounded-t-[2px] transition-all", value === 0 ? "bg-muted" : className)}
      style={{ height: `${height}%` }}
    />
  );
}

/** One stacked bar showing how a total splits. */
function Breakdown({
  parts,
  total,
}: {
  parts: { label: string; value: number; className: string }[];
  total: number;
}) {
  const shown = parts.filter((part) => part.value > 0);
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {shown.map((part) => (
          <span
            key={part.label}
            className={part.className}
            style={{ width: `${(part.value / total) * 100}%` }}
            title={`${part.label}: ${part.value}`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {parts.map((part) => (
          <li key={part.label} className="flex items-center gap-1.5 text-[12.5px]">
            <span className={cn("size-2 rounded-full", part.className)} aria-hidden />
            <span className="text-muted-foreground">{part.label}</span>
            <span className="font-medium tabular-nums">{part.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatDay(day?: string) {
  if (!day) return "";
  return new Date(day).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
