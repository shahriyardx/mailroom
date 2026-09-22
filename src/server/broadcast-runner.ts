import "server-only";
import { db } from "@/db";
import { broadcast, broadcastRecipient, listMember } from "@/db/schema";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { unsubscribeUrl } from "./campaigns";
import { deliverMessage } from "./send";

/**
 * Sending a broadcast, a few people at a time.
 *
 * Every copy goes through `deliverMessage`, the same path the composer and the
 * API use. That is more work per message than handing SES a bulk call, and it
 * is worth it: bounces, complaints, suppression and the email log already hang
 * off a message row, and a broadcast that sidestepped them would be the one
 * kind of mail nobody could account for afterwards.
 *
 * Nothing here is clever about rate. It sends a small batch each pass and
 * leaves the rest for the next one, so a broadcast to fifty thousand people
 * spreads out instead of hitting the SES rate limit and burning its retries
 * on the first minute.
 */

const globalForBroadcasts = globalThis as unknown as {
  mailroomBroadcastTimer?: ReturnType<typeof setInterval>;
  mailroomBroadcastBusy?: boolean;
};

const TICK_MS = 5_000;
/** Per pass. Deliberately low: SES rate limits are per second and per account. */
const BATCH = 25;

/** `{{name}}` and `{{fields.plan}}`, filled from the member row. */
function merge(template: string, person: { address: string; name: string | null }) {
  return template
    .replaceAll("{{address}}", person.address)
    .replaceAll("{{name}}", person.name ?? person.address);
}

/**
 * The footer, added when the writer has not written their own.
 *
 * A broadcast with no visible way out is a complaint waiting to happen, and
 * complaints cost far more than the two lines this adds. Somebody who does
 * want their own wording puts `{{unsubscribe}}` in the body and gets the URL
 * where they asked for it instead.
 */
function withUnsubscribe(body: string, url: string, html: boolean) {
  if (body.includes("{{unsubscribe}}")) return body.replaceAll("{{unsubscribe}}", url);

  return html
    ? `${body}<p style="margin-top:32px;font-size:12px;color:#6b7280">
         <a href="${url}" style="color:#6b7280">Unsubscribe from these emails</a>
       </p>`
    : `${body}\n\n---\nUnsubscribe: ${url}`;
}

export interface BroadcastRun {
  claimed: number;
  sent: number;
  failed: number;
}

export async function runBroadcastsOnce(): Promise<BroadcastRun> {
  /*
   * A scheduled broadcast whose time has come becomes a sending one. Done
   * here rather than by a clock of its own so there is a single place that
   * decides what is in flight.
   */
  await db
    .update(broadcast)
    .set({ status: "sending", startedAt: new Date() })
    .where(and(eq(broadcast.status, "scheduled"), lte(broadcast.scheduledAt, new Date())));

  const running = await db.query.broadcast.findMany({
    where: eq(broadcast.status, "sending"),
    limit: 5,
  });

  const run: BroadcastRun = { claimed: 0, sent: 0, failed: 0 };

  for (const job of running) {
    const pending = await db.query.broadcastRecipient.findMany({
      where: and(
        eq(broadcastRecipient.broadcastId, job.id),
        eq(broadcastRecipient.status, "pending"),
      ),
      limit: BATCH,
    });

    if (pending.length === 0) {
      await db
        .update(broadcast)
        .set({ status: "sent", finishedAt: new Date() })
        .where(eq(broadcast.id, job.id));
      continue;
    }

    run.claimed += pending.length;

    for (const target of pending) {
      /*
       * Asked again, one recipient at a time.
       *
       * The audience was frozen when the broadcast started, which is what
       * makes it explicable — but somebody who unsubscribes during a long
       * send has to be dropped, not written to because a list was read an
       * hour ago.
       */
      const member = await db.query.listMember.findFirst({
        where: eq(listMember.id, target.listMemberId),
        columns: { id: true, address: true, name: true, status: true },
      });

      if (!member || member.status !== "subscribed") {
        await db
          .update(broadcastRecipient)
          .set({ status: "skipped", error: "Unsubscribed before this was sent" })
          .where(eq(broadcastRecipient.id, target.id));
        continue;
      }

      const url = unsubscribeUrl(member.id);

      try {
        const result = await deliverMessage({
          orgId: job.organizationId,
          mailboxId: job.mailboxId,
          to: [{ address: member.address, name: member.name }],
          subject: merge(job.subject, member),
          html: job.html ? withUnsubscribe(merge(job.html, member), url, true) : null,
          text: job.text ? withUnsubscribe(merge(job.text, member), url, false) : null,
          headers: {
            /*
             * Gmail and Yahoo refuse bulk mail without these. The second is
             * what makes the button in their client work without the reader
             * ever seeing a web page — and it means the URL must accept a
             * POST, which the unsubscribe route does.
             */
            "List-Unsubscribe": `<${url}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });

        await db
          .update(broadcastRecipient)
          .set({ status: "sent", messageId: result.messageId, sentAt: new Date(), error: null })
          .where(eq(broadcastRecipient.id, target.id));
        run.sent += 1;
      } catch (error) {
        await db
          .update(broadcastRecipient)
          .set({
            status: "failed",
            error: error instanceof Error ? error.message : "Could not be sent",
          })
          .where(eq(broadcastRecipient.id, target.id));
        run.failed += 1;
      }
    }
  }

  return run;
}

export function startBroadcastWorker() {
  if (process.env.BROADCAST_WORKER === "false") return;
  if (globalForBroadcasts.mailroomBroadcastTimer) return;

  const tick = async () => {
    // A slow pass must not have the next one pile up behind it.
    if (globalForBroadcasts.mailroomBroadcastBusy) return;
    globalForBroadcasts.mailroomBroadcastBusy = true;
    try {
      const run = await runBroadcastsOnce();
      if (run.claimed > 0) {
        console.log(`broadcasts: ${run.sent} sent, ${run.failed} failed`);
      }
    } catch (error) {
      console.error("broadcast pass failed", error);
    } finally {
      globalForBroadcasts.mailroomBroadcastBusy = false;
    }
  };

  const timer = setInterval(tick, TICK_MS);
  // Do not hold the process open for the sake of the queue.
  timer.unref?.();
  globalForBroadcasts.mailroomBroadcastTimer = timer;
}
