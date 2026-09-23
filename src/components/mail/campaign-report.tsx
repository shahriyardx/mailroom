"use client";

import {
  Badge,
  Button,
  IconButton,
  List,
  ListEmpty,
  ListRow,
  Meter,
  Note,
  Panel,
  Stat,
  Stats,
} from "@/components/kit";
import { cn } from "@/lib/utils";
import { duplicateBroadcastAction, resendToNonOpenersAction } from "@/server/actions";
import type { BroadcastReport } from "@/server/campaigns";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  MailX,
  MousePointerClick,
  Send,
  Siren,
  UserMinus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/**
 * What one campaign did.
 *
 * Rates are worked out here rather than on the server, and every one of them
 * is over the number actually sent. "Opened over delivered" is the flattering
 * version and the one most tools quietly use; sent is the number somebody
 * pressed a button for, so it is the one divided by.
 */
function share(part: number, whole: number) {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function percent(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

export function CampaignReport({
  report,
  basePath,
}: {
  report: BroadcastReport;
  basePath: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const opens = share(report.opened, report.sent);
  const clicks = share(report.clicked, report.sent);
  const left = share(report.unsubscribed, report.sent);
  const bounces = share(report.bounced, report.sent);

  async function copy() {
    setBusy(true);
    try {
      const made = await duplicateBroadcastAction(report.id);
      if (!made.ok) throw new Error(made.error);
      toast.success("Copied to a new draft");
      router.push(`${basePath}/${made.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy it");
    } finally {
      setBusy(false);
    }
  }

  async function again() {
    setBusy(true);
    try {
      const made = await resendToNonOpenersAction(report.id);
      if (!made.ok) throw new Error(made.error);
      toast.success(`A draft for ${made.audience} people who never opened it`);
      router.push(`${basePath}/${made.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not make the follow-up");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[880px] space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={basePath}>
            <ArrowLeft />
            Campaigns
          </Link>
        </Button>
      </div>

      <Panel
        title={report.subject}
        description={
          <>
            to {report.listName}
            {report.segmentName && ` · ${report.segmentName}`}
            {report.resendOfId && " · follow-up to people who never opened the original"} · from{" "}
            {report.from}
          </>
        }
        meta={report.status}
        action={
          <span className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copy} disabled={busy}>
              <Copy />
              Duplicate
            </Button>
            {/* Only worth offering once there is somebody to offer it about. */}
            {report.status === "sent" && report.sent > report.opened && (
              <Button variant="solid" size="sm" onClick={again} disabled={busy}>
                <Send />
                Send again to non-openers
              </Button>
            )}
          </span>
        }
      >
        <Stats>
          <Stat label="Sent" value={report.sent} sub={`${report.total} in the audience`} />
          <Stat
            label="Opened"
            value={report.opened}
            sub={percent(opens)}
            tone={opens !== null && opens >= 20 ? "ok" : undefined}
          />
          <Stat label="Clicked" value={report.clicked} sub={percent(clicks)} />
          <Stat
            label="Unsubscribed"
            value={report.unsubscribed}
            sub={percent(left)}
            /* Half a per cent is the number list managers watch. Above it,
               something about the send was wrong — not the list. */
            tone={left !== null && left > 0.5 ? "warn" : undefined}
          />
        </Stats>

        {/* The same grid as above, so the eight numbers line up in columns
            rather than being two rows that nearly agree. */}
        <Stats className="mt-5">
          <Stat
            label="Bounced"
            value={report.bounced}
            sub={percent(bounces)}
            /* SES suspends accounts above five per cent. */
            tone={bounces !== null && bounces > 5 ? "bad" : undefined}
          />
          <Stat
            label="Complaints"
            value={report.complained}
            tone={report.complained > 0 ? "bad" : undefined}
          />
          <Stat label="Failed" value={report.failed} />
          <Stat label="Skipped" value={report.skipped} sub="left the list mid-send" />
        </Stats>

        {report.pending > 0 && (
          <Note className="mt-4">
            {report.pending} still to go. This page updates as they are sent.
          </Note>
        )}
      </Panel>

      {/* Two subject lines, side by side. The only question an A/B test has to
          answer is which one got opened, so that is what is drawn. */}
      {report.subjectB && report.variants.length > 1 && (
        <Panel
          title="Subject line test"
          description="The audience was split in half by a stable hash, so both sides are the same size."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {report.variants.map((variant) => {
              const rate = share(variant.opened, variant.sent);
              const best = Math.max(
                ...report.variants.map((entry) => share(entry.opened, entry.sent) ?? -1),
              );
              const winning = rate !== null && rate === best && report.variants.length > 1;

              return (
                <div
                  key={variant.variant}
                  className={cn(
                    "rounded-xl border p-4",
                    winning ? "border-ok/40 bg-ok/5" : "border-border",
                  )}
                >
                  <p className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Subject {variant.variant.toUpperCase()}
                    {winning && (
                      <Badge size="sm" tone="ok">
                        Ahead
                      </Badge>
                    )}
                  </p>
                  <p className="mt-1.5 font-medium text-[13px]">{variant.subject}</p>
                  <p className="mt-3 font-display text-[22px] font-semibold tabular-nums">
                    {percent(rate)}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {variant.opened} of {variant.sent} opened · {variant.clicked} clicked
                  </p>
                </div>
              );
            })}
          </div>
          <Note className="mt-3">
            A difference under a few points on a small list is noise, not a result.
          </Note>
        </Panel>
      )}

      <Panel
        title="Links"
        description="How many people followed each link, not how many clicks it collected."
        meta={`${report.links.length}`}
      >
        <List>
          {report.links.map((link) => (
            <ListRow key={link.url}>
              <MousePointerClick className="size-4 shrink-0 text-muted-foreground" />
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer noopener"
                className="min-w-0 flex-1 truncate font-mono text-[12.5px] hover:underline"
              >
                {link.url}
              </a>
              <span className="w-24 shrink-0">
                <Meter value={link.people} max={Math.max(report.sent, 1)} />
              </span>
              <span className="w-24 shrink-0 text-right text-[12px] text-muted-foreground tabular-nums">
                {link.people} {link.people === 1 ? "person" : "people"}
              </span>
            </ListRow>
          ))}
          {report.links.length === 0 && (
            <ListEmpty>
              No clicks recorded. Click tracking needs it switching on in the SES configuration set
              — without that, SES never rewrites the links and never tells us.
            </ListEmpty>
          )}
        </List>
      </Panel>

      <Panel
        title="Recipients"
        description="Whoever did something with it, first."
        meta={`${report.recipients.length}`}
      >
        <List>
          {report.recipients.map((person) => (
            <ListRow key={person.address}>
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                {person.address}
              </span>
              {report.subjectB && (
                <Badge size="sm" tone="neutral">
                  {person.variant.toUpperCase()}
                </Badge>
              )}
              {person.clickedAt && (
                <Badge size="sm" tone="ok">
                  Clicked
                </Badge>
              )}
              {person.openedAt && !person.clickedAt && (
                <Badge size="sm" tone="neutral">
                  Opened
                </Badge>
              )}
              {person.unsubscribedAt && (
                <Badge size="sm" tone="warn">
                  Left
                </Badge>
              )}
              {person.status === "failed" && (
                <Badge size="sm" tone="danger" className="max-w-[240px] truncate">
                  {person.error ?? "Failed"}
                </Badge>
              )}
              {person.status === "skipped" && (
                <Badge size="sm" tone="neutral">
                  Skipped
                </Badge>
              )}
            </ListRow>
          ))}
          {report.recipients.length === 0 && <ListEmpty>Nobody yet.</ListEmpty>}
        </List>
        {report.total > report.recipients.length && (
          <Note className="mt-3">
            Showing {report.recipients.length} of {report.total}. The counts above cover all of
            them.
          </Note>
        )}
      </Panel>
    </div>
  );
}
