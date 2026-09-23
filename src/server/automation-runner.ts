import "server-only";
import { db } from "@/db";
import {
  type AutomationNode,
  automation,
  automationNode,
  automationRun,
  automationSend,
  listMember,
  segment,
  workspace,
} from "@/db/schema";
import { merge, withFooter } from "@/lib/campaign-body";
import { newId } from "@/lib/utils";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { subscribe, unsubscribeUrl } from "./campaigns";
import { segmentCondition } from "./segments";
import { deliverMessage } from "./send";

/**
 * The clock behind automations.
 *
 * Two jobs. Enrol whoever has newly joined a list an automation watches, and
 * walk whoever is due to the next thing that happens to them.
 *
 * There is no timer per person. A run is a row with a node and a date on it,
 * so a flow with a fortnight's wait in the middle costs exactly one index
 * lookup a tick — the same as one with no wait at all.
 */

const globalForAutomations = globalThis as unknown as {
  mailroomAutomationTimer?: ReturnType<typeof setInterval>;
  mailroomAutomationBusy?: boolean;
};

const TICK_MS = 30_000;
/** Runs advanced per pass. The same reasoning as the campaign runner: SES rates. */
const BATCH = 25;

/**
 * Nodes one run may pass through in a single tick.
 *
 * Conditions and field writes take no time, so a run walks through them
 * immediately rather than waiting thirty seconds per box. The cap is what
 * stops a flow that somehow points back at itself from spinning forever —
 * the editor cannot build one, but a half-applied edit in principle could.
 */
const HOPS = 20;

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
 *
 * Only the automations that start on joining. The other kind starts on an
 * event your own code posts, and that is caught when it happens rather than
 * noticed afterwards — there is no state left behind for a sweep to find.
 */
async function enrol(): Promise<number> {
  const live = await db.query.automation.findMany({
    where: and(eq(automation.status, "active"), eq(automation.trigger, "subscribed")),
  });
  let made = 0;

  for (const job of live) {
    if (!job.entryNodeId || !job.listId) continue;

    /*
     * A narrowing is asked here, at the moment somebody would be enrolled,
     * rather than kept as a membership somewhere. A flow for "people on the
     * pro plan" is then right on the day it runs.
     */
    const narrowing = job.segmentId
      ? await db.query.segment.findFirst({ where: eq(segment.id, job.segmentId) })
      : null;

    const fresh = await db
      .select({ id: listMember.id })
      .from(listMember)
      .where(
        and(
          eq(listMember.listId, job.listId),
          eq(listMember.status, "subscribed"),
          narrowing ? segmentCondition(narrowing) : undefined,
          /*
           * The date goes in as text and is cast, not handed over as a Date:
           * inside a raw fragment there is no column to tell the driver what
           * type it should be, and postgres-js refuses it outright.
           */
          sql`coalesce(${listMember.consentAt}, ${listMember.createdAt}) >= ${job.createdAt.toISOString()}::timestamptz`,
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
          nodeId: job.entryNodeId,
          nextAt: new Date(),
        })),
      )
      .onConflictDoNothing();

    made += fresh.length;
  }

  return made;
}

/** Whether a condition node's answer is yes for this person. */
async function answer(
  node: AutomationNode,
  automationId: string,
  member: { id: string; address: string; fields: Record<string, string>; tags: string[] },
): Promise<boolean> {
  const test = node.config.test ?? "opened";

  if (test === "tag") {
    const tag = node.config.tag?.trim();
    return tag ? member.tags.includes(tag) : false;
  }

  /*
   * A whole segment as one question.
   *
   * Everything the segment language can ask — opened nothing in thirty days,
   * joined before a date, a field, a tag, any of them combined — becomes
   * available to a condition without a second rule builder growing here.
   */
  if (test === "segment") {
    if (!node.config.segmentId) return false;
    const narrowing = await db.query.segment.findFirst({
      where: eq(segment.id, node.config.segmentId),
    });
    if (!narrowing) return false;

    const [match] = await db
      .select({ id: listMember.id })
      .from(listMember)
      .where(and(eq(listMember.id, member.id), segmentCondition(narrowing)))
      .limit(1);
    return Boolean(match);
  }

  /*
   * On another list, asked by address: the same person is a different row on
   * every list they are on, and the address is what ties them together.
   */
  if (test === "list") {
    if (!node.config.listId) return false;
    const [found] = await db
      .select({ id: listMember.id })
      .from(listMember)
      .where(
        and(
          eq(listMember.listId, node.config.listId),
          eq(listMember.address, member.address),
          eq(listMember.status, "subscribed"),
        ),
      )
      .limit(1);
    return node.config.op === "is_not" ? !found : Boolean(found);
  }

  if (test === "opened" || test === "clicked") {
    /*
     * "The last email" means the last one *this flow* sent them.
     *
     * It used to mean any campaign they had ever been sent, which read the
     * campaign tables — and an automation writes nothing there, so the
     * question every drip hangs on ("they did not open it, so nudge them")
     * answered no for everybody who had only ever had automation mail. The
     * branch looked like it worked and never did.
     *
     * Asked of the sends rather than remembered on the run, so a condition
     * placed after two emails reads the second one.
     */
    const [last] = await db
      .select({ openedAt: automationSend.openedAt, clickedAt: automationSend.clickedAt })
      .from(automationSend)
      .where(
        and(
          eq(automationSend.automationId, automationId),
          eq(automationSend.listMemberId, member.id),
        ),
      )
      .orderBy(desc(automationSend.sentAt))
      .limit(1);

    // Nothing sent yet is not "they ignored it": a condition placed before
    // the first email takes the no branch, which is the honest answer.
    if (!last) return false;
    return test === "opened" ? last.openedAt !== null : last.clickedAt !== null;
  }

  const key = node.config.field ?? "";
  const held = member.fields[key];
  const want = (node.config.value ?? "").toLowerCase();

  switch (node.config.op ?? "is") {
    case "set":
      return Boolean(held);
    case "not_set":
      return !held;
    case "is_not":
      return (held ?? "").toLowerCase() !== want;
    case "contains":
      return (held ?? "").toLowerCase().includes(want);
    default:
      return (held ?? "").toLowerCase() === want;
  }
}

export async function runAutomationsOnce(): Promise<AutomationPass> {
  const pass: AutomationPass = { enrolled: await enrol(), sent: 0, failed: 0 };

  const due = await db
    .select({
      runId: automationRun.id,
      automationId: automationRun.automationId,
      memberId: automationRun.listMemberId,
      nodeId: automationRun.nodeId,
      orgId: automationRun.organizationId,
      automationName: automation.name,
      mailboxId: automation.mailboxId,
      listId: automation.listId,
      exitSegmentId: automation.exitSegmentId,
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
    const member = await db.query.listMember.findFirst({
      where: eq(listMember.id, job.memberId),
      columns: {
        id: true,
        address: true,
        name: true,
        status: true,
        fields: true,
        tags: true,
      },
    });

    /*
     * Somebody who left mid-flow is out of it, not skipped to the next box.
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

    /*
     * Out early, if what the flow was for has already happened.
     *
     * Checked before every step rather than only at the start, because the
     * point of it is the thing that happens while somebody is part-way
     * through: a cart-recovery flow must stop the moment they pay, not carry
     * on nagging them until the last email.
     */
    if (job.exitSegmentId) {
      const goal = await db.query.segment.findFirst({
        where: eq(segment.id, job.exitSegmentId),
      });
      if (goal) {
        const [reached] = await db
          .select({ id: listMember.id })
          .from(listMember)
          .where(and(eq(listMember.id, member.id), segmentCondition(goal)))
          .limit(1);

        if (reached) {
          await db
            .update(automationRun)
            .set({ status: "stopped", stoppedReason: `Matched "${goal.name}"` })
            .where(eq(automationRun.id, job.runId));
          continue;
        }
      }
    }

    const [site] = await db
      .select({ postalAddress: workspace.postalAddress })
      .from(workspace)
      .where(eq(workspace.organizationId, job.orgId))
      .limit(1);

    let at: string | null = job.nodeId;
    let waitUntil: Date | null = null;
    let fields = member.fields;
    let tags = member.tags;

    for (let hop = 0; hop < HOPS && at && !waitUntil; hop += 1) {
      const node: AutomationNode | undefined = await db.query.automationNode.findFirst({
        where: and(eq(automationNode.id, at), eq(automationNode.automationId, job.automationId)),
      });
      if (!node) {
        at = null;
        break;
      }

      if (node.kind === "wait") {
        // Nothing happens here; it is the pause itself.
        at = node.next;

        if (node.waitUntil) {
          /*
           * A moment rather than a length of time, so everybody waiting here
           * moves on together whenever they arrived.
           *
           * Somebody who reaches it after the moment has passed walks
           * straight through. Holding them until the same date next year is
           * the only alternative, and nobody means that.
           */
          if (node.waitUntil.getTime() <= Date.now()) continue;
          waitUntil = node.waitUntil;
          break;
        }

        waitUntil = new Date(Date.now() + node.delayMinutes * 60_000);
        break;
      }

      if (node.kind === "condition") {
        at = (await answer(node, job.automationId, {
          id: member.id,
          address: member.address,
          fields,
          tags,
        }))
          ? node.next
          : node.nextElse;
        continue;
      }

      if (node.kind === "field") {
        const key = node.config.field?.trim();
        if (key) {
          fields = { ...fields, [key]: node.config.value ?? "" };
          await db.update(listMember).set({ fields }).where(eq(listMember.id, member.id));
        }
        at = node.next;
        continue;
      }

      if (node.kind === "tag") {
        const tag = node.config.tag?.trim();
        if (tag) {
          /*
           * A tag is a set somebody is in or out of, so adding one twice is
           * not two of anything and removing one they never had is not an
           * error. Written from the copy this pass is carrying, so two tag
           * boxes in a row do not undo each other.
           */
          tags =
            node.config.tagAction === "remove"
              ? tags.filter((entry) => entry !== tag)
              : tags.includes(tag)
                ? tags
                : [...tags, tag];
          await db.update(listMember).set({ tags }).where(eq(listMember.id, member.id));
        }
        at = node.next;
        continue;
      }

      if (node.kind === "move") {
        const target = node.config.listId;
        const moving = node.config.listAction === "move";

        if (target && target !== job.listId) {
          /*
           * Everything about them comes along: the name to address them by,
           * the fields a later subject merges, the tags a later segment asks
           * about. A copy that arrives as a bare address is a copy nobody
           * can send to properly.
           */
          const landed = await subscribe(
            job.orgId,
            target,
            { address: member.address, name: member.name, fields },
            `automation: ${job.automationName}`,
          );
          if (landed.status !== "blocked" && tags.length > 0) {
            await db.update(listMember).set({ tags }).where(eq(listMember.id, landed.id));
          }
        }

        if (moving) {
          /*
           * Taken off this list, which is the list this flow follows — so
           * their journey through it ends here. Marked rather than deleted:
           * deleting the row would take the record of everything ever sent
           * to them with it.
           */
          await db
            .update(listMember)
            .set({ status: "unsubscribed", unsubscribedAt: new Date() })
            .where(eq(listMember.id, member.id));
          at = null;
          break;
        }

        at = node.next;
        continue;
      }

      if (node.kind === "unsubscribe") {
        await db
          .update(listMember)
          .set({ status: "unsubscribed", unsubscribedAt: new Date() })
          .where(eq(listMember.id, member.id));
        at = null;
        break;
      }

      // An email. Anything below here sends.
      const url = unsubscribeUrl(member.id);
      /*
       * The fields as they are now, not as the row was read.
       *
       * A Set a field box earlier in this same pass has already changed them,
       * and an email that greets somebody by the plan they were on before the
       * flow upgraded them is the sort of thing they notice.
       */
      const person = { address: member.address, name: member.name, fields };
      try {
        const sent = await deliverMessage({
          orgId: job.orgId,
          mailboxId: job.mailboxId,
          to: [{ address: member.address, name: member.name }],
          subject: merge(node.subject ?? "", person),
          html: node.html
            ? withFooter(
                merge(node.html, person, true),
                { unsubscribeUrl: url, postalAddress: site?.postalAddress ?? null },
                true,
              )
            : null,
          text: node.text
            ? withFooter(
                merge(node.text, person),
                { unsubscribeUrl: url, postalAddress: site?.postalAddress ?? null },
                false,
              )
            : null,
          headers: {
            "List-Unsubscribe": `<${url}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        /*
         * Written down, because otherwise nothing knows this flow ever wrote
         * to them. The condition two boxes down asks this table, and the
         * card on the canvas counts it.
         */
        await db.insert(automationSend).values({
          id: newId("ase"),
          organizationId: job.orgId,
          automationId: job.automationId,
          nodeId: node.id,
          listMemberId: member.id,
          messageId: sent.messageId,
          address: member.address,
          subject: merge(node.subject ?? "", person),
        });

        pass.sent += 1;
        at = node.next;
      } catch (error) {
        /*
         * Tried again in an hour rather than dropped.
         *
         * Almost everything that fails here is temporary — SES throttling, a
         * domain mid-verification — and abandoning the second email of a
         * welcome series over a blip is worse than being an hour late.
         */
        await db
          .update(automationRun)
          .set({
            nextAt: new Date(Date.now() + 3_600_000),
            stoppedReason: error instanceof Error ? error.message : "Could not be sent",
          })
          .where(eq(automationRun.id, job.runId));
        pass.failed += 1;
        at = null;
        waitUntil = new Date(Date.now() + 3_600_000);
        break;
      }
    }

    // Only write the run once, whatever route it took through the flow.
    if (waitUntil && at) {
      await db
        .update(automationRun)
        .set({ nodeId: at, nextAt: waitUntil, lastSentAt: new Date() })
        .where(eq(automationRun.id, job.runId));
    } else if (!at) {
      await db
        .update(automationRun)
        .set({ status: "done", nodeId: null, lastSentAt: new Date() })
        .where(eq(automationRun.id, job.runId));
    } else {
      // Ran out of hops. Picked up again next tick rather than abandoned.
      await db
        .update(automationRun)
        .set({ nodeId: at, nextAt: new Date(Date.now() + TICK_MS) })
        .where(eq(automationRun.id, job.runId));
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
