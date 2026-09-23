import "server-only";
import { db } from "@/db";
import { broadcast, broadcastRecipient, listMember, workspace } from "@/db/schema";
import { merge, withFooter } from "@/lib/campaign-body";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { archiveUrl, preferencesUrl, unsubscribeUrl } from "./campaigns";
import { deliverMessage } from "./send";
import { sendBudget } from "./send-rate";

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
    /*
     * Cannot happen — starting one refuses without an address — but the
     * column allows null so that a draft can exist before anybody has made a
     * mailbox, and a runner that assumed otherwise would be a crash rather
     * than a stuck campaign.
     */
    if (!job.mailboxId) continue;

    /*
     * The hourly ceiling, if this instance set one.
     *
     * Checked per pass rather than once, because an automation sending
     * alongside this campaign spends from the same allowance. Reaching it
     * leaves the campaign exactly as it is — still sending, with everybody
     * unsent still pending — and the next pass after the window rolls picks
     * it back up. Nothing is dropped and nothing is sent twice.
     */
    const budget = await sendBudget(job.organizationId);
    if (budget.remaining <= 0) continue;

    const pending = await db.query.broadcastRecipient.findMany({
      where: and(
        eq(broadcastRecipient.broadcastId, job.id),
        eq(broadcastRecipient.status, "pending"),
      ),
      limit: Math.min(BATCH, budget.remaining),
    });

    if (pending.length === 0) {
      await db
        .update(broadcast)
        .set({ status: "sent", finishedAt: new Date() })
        .where(eq(broadcast.id, job.id));
      continue;
    }

    run.claimed += pending.length;

    /*
     * The company's own address, read once per campaign rather than per copy.
     * It goes in the footer of every message, which is what CAN-SPAM asks for
     * and what Gmail's bulk rules look at.
     */
    const [site] = await db
      .select({ postalAddress: workspace.postalAddress })
      .from(workspace)
      .where(eq(workspace.organizationId, job.organizationId))
      .limit(1);
    const footer = { postalAddress: site?.postalAddress ?? null };
    // The same for everybody on this campaign: the web copy is of the
    // campaign, not of one person's copy of it.
    const web = archiveUrl(job.id);

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
        columns: { id: true, address: true, name: true, status: true, fields: true },
      });

      if (!member || member.status !== "subscribed") {
        await db
          .update(broadcastRecipient)
          .set({ status: "skipped", error: "Unsubscribed before this was sent" })
          .where(eq(broadcastRecipient.id, target.id));
        continue;
      }

      const url = unsubscribeUrl(member.id);
      /*
       * Handed in as a field rather than handled as a placeholder of its own,
       * so it substitutes, escapes and falls back like everything else — and
       * so an automation, which has no web copy, simply does not have it.
       */
      const person = {
        ...member,
        fields: {
          ...member.fields,
          view_in_browser: web,
          preferences: preferencesUrl(member.id),
        },
      };

      try {
        const result = await deliverMessage({
          orgId: job.organizationId,
          mailboxId: job.mailboxId,
          to: [{ address: member.address, name: member.name }],
          // Which subject line this copy was assigned when the audience froze.
          subject: merge(
            target.variant === "b" && job.subjectB ? job.subjectB : job.subject,
            person,
          ),
          html: job.html
            ? withFooter(merge(job.html, person, true), { ...footer, unsubscribeUrl: url }, true)
            : null,
          text: job.text
            ? withFooter(merge(job.text, person), { ...footer, unsubscribeUrl: url }, false)
            : null,
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
