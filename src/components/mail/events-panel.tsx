"use client";

import { Button, List, ListRow, Note, Panel, StatusPill } from "@/components/kit";
import { setUpEventsAction } from "@/server/actions";
import type { EventsStatus } from "@/server/events";
import { Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

export function EventsPanel({ status }: { status: EventsStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const live =
    status.configurationSet && status.destination.present && status.subscription === "confirmed";
  // A pipeline built before opens were asked for still reports everything
  // else, so it is worth saying that running the button again adds them.
  const missingOpens = live && !status.destination.opens;

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
              {status.destination.eventTypes} event types
            </span>
            <StatusPill state={status.destination.present ? "ok" : "pending"}>
              {status.destination.present ? "Enabled" : "Missing"}
            </StatusPill>
          </ListRow>
          <ListRow>
            <span className="min-w-0 flex-1 text-[13px]">Open tracking</span>
            <span className="hidden text-[12px] text-muted-foreground sm:block">
              An image SES adds to outgoing HTML
            </span>
            <StatusPill state={status.destination.opens ? "ok" : "pending"}>
              {status.destination.opens ? "On" : "Off"}
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
        </List>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Note className="mr-auto max-w-md">
          {missingOpens
            ? "Reporting works, but this pipeline was made before open tracking. Run it again to turn opens on."
            : live
              ? "Everything is in place. Running this again is harmless: each piece is only created when missing."
              : "Creates the topic, allows SES to publish to it, adds the configuration set and its event destination, then subscribes this app. AWS confirms the subscription by calling back."}
        </Note>
        <Button
          variant={live && !missingOpens ? "outline" : "solid"}
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
          {live ? "Run again" : "Set up delivery reporting"}
        </Button>
      </div>
    </Panel>
  );
}
