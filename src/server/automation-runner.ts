import "server-only";
import { db } from "@/db";
import { automation, automationRun, automationStep, listMember, workspace } from "@/db/schema";
import { merge, withFooter } from "@/lib/campaign-body";
import { newId } from "@/lib/utils";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { unsubscribeUrl } from "./campaigns";
import { deliverMessage } from "./send";

/**
 * The clock behind automations.
 *
 * Two jobs, both cheap. Enrol whoever has newly joined a list an automation
 * watches, and send whatever step is now due.
 *
 * There is no timer per person. A run is a row with a date on it, so a series
 * with a fortnight between steps costs exactly one index lookup a tick — the
 * same as one with no gap at all.
 */

const globalForAutomations = globalThis as unknown as {
  mailroomAutomationTimer?: ReturnType<typeof setInterval>;
  mailroomAutomationBusy?: boolean;
};

const TICK_MS = 30_000;
/** Per pass, per job. The same reasoning as the broadcast runner: SES rates. */
const BATCH = 25;

export interface AutomationPass {
  enrolled: number;
  sent: number;
  failed: number;
}

/**
 * Puts newly subscribed people into the automations that watch their list.
 *
 * Swept rather than hooked into the subscribe path, so somebody added by an
 * import, by the API and by a signup form all arrive the same way — and so
 * that turning an automation on does not need a backfill written by hand.
 *
 * Only people who joined after the automation was switched on are enrolled.
 * Switching on a welcome series must not send a welcome to a list of ten
 * thousand people who have been subscribers for two years.
 */
async function enrol(): Promise<number> {
  const live = await db.query.automation.findMany({ where: eq(automation.status, "active") });
  let made = 0;

  for (const job of live) {
    const [first] = await db
      .select({ delayMinutes: automationStep.delayMinutes })
      .from(automationStep)
      .where(eq(automationStep.automationId, job.id))
      .orderBy(asc(automationStep.position))
      .limit(1);
    if (!first) continue;

    const fresh = await db
      .select({ id: listMember.id, consentAt: listMember.consentAt })
      .from(listMember)
      .where(
        and(
          eq(listMember.listId, job.listId),
          eq(listMember.status, "subscribed"),
          sql`coalesce(${listMember.consentAt}, ${listMember.createdAt}) >= ${job.createdAt}`,
          sql`not exists (
            select 1 from automation_run
            where automation_run.automation_id = ${job.id}
              and automation_run.list_member_id = ${listMember.id}
          )`,
        ),
      )
      .limit(500);

    if (fresh.length === 0) continue;

    await db
      .insert(automationRun)
      .values(
        fresh.map((person) => ({
          id: newId("aur"),
          organizationId: job.organizationId,
          automationId: job.id,
          listMemberId: person.id,
          step: 0,
          nextAt: new Date(Date.now() + first.delayMinutes * 60_000),
        })),
      )
      .onConflictDoNothing();

    made += fresh.length;
  }

  return made;
}

export async function runAutomationsOnce(): Promise<AutomationPass> {
  const pass: AutomationPass = { enrolled: await enrol(), sent: 0, failed: 0 };

  const due = await db
    .select({
      runId: automationRun.id,
      automationId: automationRun.automationId,
      memberId: automationRun.listMemberId,
      step: automationRun.step,
      orgId: automationRun.organizationId,
      mailboxId: automation.mailboxId,
    })
    .from(automationRun)
    .innerJoin(automation, eq(automation.id, automationRun.automationId))
    .where(
      and(
        eq(automationRun.status, "active"),
        // A paused automation stops sending without losing where anybody is.
        eq(automation.status, "active"),
        lte(automationRun.nextAt, new Date()),
      ),
    )
    .limit(BATCH);

  for (const job of due) {
    const [step, next, member] = await Promise.all([
      db.query.automationStep.findFirst({
        where: and(
          eq(automationStep.automationId, job.automationId),
          eq(automationStep.position, job.step),
        ),
      }),
      db.query.automationStep.findFirst({
        where: and(
          eq(automationStep.automationId, job.automationId),
          eq(automationStep.position, job.step + 1),
        ),
      }),
      db.query.listMember.findFirst({
        where: eq(listMember.id, job.memberId),
        columns: { id: true, address: true, name: true, status: true },
      }),
    ]);

    /*
     * Somebody who left mid-series is out of it, not skipped to the next one.
     * The run is kept rather than deleted so the record of how far they got
     * survives, and so re-subscribing does not silently restart them.
     */
    if (!member || member.status !== "subscribed") {
      await db
        .update(automationRun)
        .set({ status: "stopped", stoppedReason: "Left the list" })
        .where(eq(automationRun.id, job.runId));
      continue;
    }

    if (!step) {
      await db.update(automationRun).set({ status: "done" }).where(eq(automationRun.id, job.runId));
      continue;
    }

    const [site] = await db
      .select({ postalAddress: workspace.postalAddress })
      .from(workspace)
      .where(eq(workspace.organizationId, job.orgId))
      .limit(1);

    const url = unsubscribeUrl(member.id);

    try {
      await deliverMessage({
        orgId: job.orgId,
        mailboxId: job.mailboxId,
        to: [{ address: member.address, name: member.name }],
        subject: merge(step.subject, member),
        html: step.html
          ? withFooter(
              merge(step.html, member),
              { unsubscribeUrl: url, postalAddress: site?.postalAddress ?? null },
              true,
            )
          : null,
        text: step.text
          ? withFooter(
              merge(step.text, member),
              { unsubscribeUrl: url, postalAddress: site?.postalAddress ?? null },
              false,
            )
          : null,
        headers: {
          "List-Unsubscribe": `<${url}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      await db
        .update(automationRun)
        .set({
          step: job.step + 1,
          lastSentAt: new Date(),
          status: next ? "active" : "done",
          nextAt: next ? new Date(Date.now() + next.delayMinutes * 60_000) : new Date(),
        })
        .where(eq(automationRun.id, job.runId));
      pass.sent += 1;
    } catch (error) {
      /*
       * Tried again in an hour rather than dropped.
       *
       * Almost everything that fails here is temporary — SES throttling, a
       * domain mid-verification — and giving up on the second email of a
       * welcome series because of a blip is worse than being an hour late.
       */
      await db
        .update(automationRun)
        .set({
          nextAt: new Date(Date.now() + 3_600_000),
          stoppedReason: error instanceof Error ? error.message : "Could not be sent",
        })
        .where(eq(automationRun.id, job.runId));
      pass.failed += 1;
    }
  }

  return pass;
}

export function startAutomationWorker() {
  if (process.env.AUTOMATION_WORKER === "false") return;
  if (globalForAutomations.mailroomAutomationTimer) return;

  const tick = async () => {
    if (globalForAutomations.mailroomAutomationBusy) return;
    globalForAutomations.mailroomAutomationBusy = true;
    try {
      const pass = await runAutomationsOnce();
      if (pass.enrolled > 0 || pass.sent > 0 || pass.failed > 0) {
        console.log(
          `automations: ${pass.enrolled} enrolled, ${pass.sent} sent, ${pass.failed} failed`,
        );
      }
    } catch (error) {
      console.error("automation pass failed", error);
    } finally {
      globalForAutomations.mailroomAutomationBusy = false;
    }
  };

  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  globalForAutomations.mailroomAutomationTimer = timer;
}
