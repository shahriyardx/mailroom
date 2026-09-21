"use client";

import { Badge, Button, List, ListRow, Note, Panel, StatusPill, Switch } from "@/components/kit";
import { EVENT_KINDS, OPTIONAL_KINDS, REQUIRED_SUMMARY } from "@/lib/ses-events";
import { cn } from "@/lib/utils";
import { setEventTypesAction, setUpEventsAction } from "@/server/actions";
import type { EventsStatus } from "@/server/events";
import { Check, Copy, Eye, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function EventsPanel({ status }: { status: EventsStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const live =
    status.configurationSet && status.destination.present && status.subscription === "confirmed";

  return (
    <Panel
      title="Delivery reporting"
      description="SES tells this app what happened to each message it sent — delivered, bounced, or reported as spam — through an SNS topic that calls back here."
      action={
        <StatusPill state={live ? "ok" : status.error ? "bad" : "pending"}>
          {live ? "Reporting" : "Not set up"}
        </StatusPill>
      }
    >
      {status.error ? (
        <p className="mb-4 rounded-xl bg-danger-soft px-3 py-2 text-[12.5px] text-destructive">
          AWS could not be reached: {status.error}
        </p>
      ) : (
        <>
          <Pipeline status={status} />
          <Reported status={status} />
        </>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Note className="mr-auto max-w-md">
          {live && status.topicArn
            ? "Optional: set SES_SNS_TOPIC_ARN to the topic above and redeploy, and this app will refuse events from any other topic."
            : live
              ? "Everything is in place. Running this again is harmless: each piece is only created when missing."
              : "Creates the topic, allows SES to publish to it, adds the configuration set and its event destination, then subscribes this app. AWS confirms the subscription by calling back."}
        </Note>
        <Button
          variant={live ? "outline" : "solid"}
          pill
          loading={pending}
          onClick={() =>
            start(async () => {
              const result = await setUpEventsAction();
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success(
                result.status.subscription === "confirmed"
                  ? "Delivery reporting is live"
                  : "Set up. AWS is confirming the subscription now.",
              );
              router.refresh();
            })
          }
        >
          {!pending && <Zap />}
          {live ? "Repair pipeline" : "Set up delivery reporting"}
        </Button>
      </div>
    </Panel>
  );
}

/** The four pieces AWS has to have in place before anything is reported. */
function Pipeline({ status }: { status: EventsStatus }) {
  return (
    <List>
      <ListRow>
        <span className="min-w-0 flex-1 text-[13px]">Configuration set</span>
        <span className="font-mono text-[12px] text-muted-foreground">{status.name}</span>
        <StatusPill state={status.configurationSet ? "ok" : "pending"}>
          {status.configurationSet ? "Present" : "Missing"}
        </StatusPill>
      </ListRow>
      <ListRow>
        <span className="min-w-0 flex-1 text-[13px]">Event destination</span>
        <span className="text-[12px] text-muted-foreground">
          {status.destination.types.length} of {EVENT_KINDS.length} events
        </span>
        <StatusPill state={status.destination.present ? "ok" : "pending"}>
          {status.destination.present ? "Enabled" : "Missing"}
        </StatusPill>
      </ListRow>
      <ListRow>
        <span className="min-w-0 flex-1 text-[13px]">Callback subscription</span>
        <span className="hidden truncate font-mono text-[12px] text-muted-foreground sm:block">
          {status.endpoint}
        </span>
        <StatusPill
          state={
            status.subscription === "confirmed"
              ? "ok"
              : status.subscription === "pending"
                ? "pending"
                : "bad"
          }
        >
          {status.subscription === "confirmed"
            ? "Confirmed"
            : status.subscription === "pending"
              ? "Awaiting AWS"
              : "Missing"}
        </StatusPill>
      </ListRow>
      {status.topicArn ? (
        <ListRow>
          <span className="min-w-0 shrink-0 text-[13px]">SNS topic</span>
          {/* Printed because SES_SNS_TOPIC_ARN is the one setting nobody
              can work out for themselves: it contains the AWS account id,
              and it only exists once this pipeline has been built. */}
          <span className="min-w-0 flex-1 overflow-hidden text-right text-[12px] text-muted-foreground">
            <CopyArn value={status.topicArn} />
          </span>
        </ListRow>
      ) : null}
    </List>
  );
}

/**
 * Which events SES reports.
 *
 * A count was all this used to show, which said nothing about whether a
 * tracking image was being added to outgoing mail — the one item here a
 * reader of the mail would notice, and the one worth being able to refuse.
 *
 * One line per event, hint beside the label rather than under it: ten
 * two-line rows made a panel longer than the screen out of five switches.
 */
function Reported({ status }: { status: EventsStatus }) {
  const router = useRouter();
  const [saving, start] = useTransition();
  const [types, setTypes] = useState<string[]>(status.destination.types);
  const ready = status.destination.present;

  function toggle(type: string, on: boolean) {
    const next = on ? [...types, type] : types.filter((item) => item !== type);
    setTypes(next);
    start(async () => {
      const result = await setEventTypesAction(next);
      if (!result.ok) {
        setTypes(types);
        toast.error(result.error);
        return;
      }
      setTypes(result.status.destination.types);
      toast.success(on ? "Now reporting this" : "No longer reporting this");
      router.refresh();
    });
  }

  return (
    <div className="mt-5">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-[12.5px] font-semibold">What SES reports</p>
        {status.destination.opens && (
          <Badge size="sm" tone="warn">
            <Eye />
            Tracking image on
          </Badge>
        )}
      </div>
      <List>
        {/* The required five share a row: the app reads them to decide what
            happened to a message, and without bounces and complaints the
            suppression list stops growing. Nothing to decide, so no switch. */}
        <ListRow className="py-2.5">
          <span className="min-w-0 flex-1 truncate text-[13px]">
            Delivery outcomes
            <span className="ml-2 text-[12px] text-muted-foreground">{REQUIRED_SUMMARY}</span>
          </span>
          <Badge size="sm" tone="neutral">
            Always on
          </Badge>
        </ListRow>
        {OPTIONAL_KINDS.map((kind) => (
          <ListRow key={kind.type} className="py-2.5">
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {kind.label}
              <span
                className={cn(
                  "ml-2 text-[12px]",
                  kind.altersMessage ? "text-warn" : "text-muted-foreground",
                )}
              >
                {kind.hint}
              </span>
            </span>
            <Switch
              checked={types.includes(kind.type)}
              disabled={!ready || saving}
              aria-label={kind.label}
              onCheckedChange={(next) => toggle(kind.type, next)}
            />
          </ListRow>
        ))}
      </List>
    </div>
  );
}

/** The ARN is long and is only ever copied, never read. */
function CopyArn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${value}`}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
            toast.success("Copied", { description: value });
          },
          () => toast.error("Could not copy. Select the value and copy it by hand."),
        );
      }}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left font-mono hover:bg-accent"
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="size-3 shrink-0 text-ok" />
      ) : (
        <Copy className="size-3 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
      )}
    </button>
  );
}
