import "server-only";
import { db } from "@/db";
import {
  type AutomationNodeKind,
  type AutomationStatus,
  type AutomationTrigger,
  type NodeConfig,
  type SendWindow,
  automation,
  automationNode,
  automationRun,
  automationSend,
  listMember,
  mailbox,
  mailingList,
  segment,
} from "@/db/schema";
import { forks } from "@/lib/automation-flow";
import { type EmailDesign, designToText, renderDesign } from "@/lib/email-blocks";
import { env } from "@/lib/env";
import { isTimeZone } from "@/lib/send-window";
import { newId } from "@/lib/utils";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { normaliseEventName } from "./custom-events";
import { checkWebhookUrl, makeWebhookSecret } from "./webhooks";

/**
 * Series of emails that start when one person does something.
 *
 * The difference from a campaign is who decides the clock. A campaign goes to
 * everybody at once; an automation's third message lands three days after
 * *their* signup, whenever that was.
 *
 * Deliberately a tree — one trigger, boxes that branch but never rejoin.
 * A single predecessor per box is what lets the canvas lay itself out, so
 * nobody has to drag anything to keep the picture readable.
 */

/**
 * A new automation, with nothing decided but its name and who it comes from.
 *
 * No trigger and no list: both are chosen on the canvas, in the same place
 * and the same way as everything else that happens in the flow. Asking "what
 * starts this" in a dialog before anybody has seen the canvas is asking it
 * where the answer cannot be seen in context.
 */
export async function createAutomation(
  orgId: string,
  input: { mailboxId?: string | null; name: string },
) {
  const name = input.name.trim();
  if (!name) throw new Error("Give the automation a name");

  /*
   * An address is optional here and required to switch it on.
   *
   * Drawing a flow is the work, and on a fresh instance there is no verified
   * sending address to pick — so demanding one up front meant nothing could
   * be designed on the day somebody installed this.
   */
  const box = input.mailboxId
    ? await db.query.mailbox.findFirst({
        where: and(eq(mailbox.id, input.mailboxId), eq(mailbox.organizationId, orgId)),
        columns: { id: true },
      })
    : null;
  if (input.mailboxId && !box) throw new Error("No such mailbox");

  const id = newId("aut");
  await db.insert(automation).values({
    id,
    organizationId: orgId,
    mailboxId: input.mailboxId ?? null,
    name,
  });
  return id;
}

export async function findAutomation(orgId: string, id: string) {
  const row = await db.query.automation.findFirst({
    where: and(eq(automation.id, id), eq(automation.organizationId, orgId)),
  });
  if (!row) return null;

  const nodes = await db
    .select()
    .from(automationNode)
    .where(eq(automationNode.automationId, id))
    .orderBy(asc(automationNode.createdAt));

  return { ...row, nodes };
}

export async function updateAutomation(
  orgId: string,
  id: string,
  input: {
    name?: string;
    mailboxId?: string;
    status?: AutomationStatus;
    trigger?: AutomationTrigger;
    listId?: string | null;
    eventName?: string | null;
    segmentId?: string | null;
    exitSegmentId?: string | null;
    exitEventName?: string | null;
    /** Null to send at any time. */
    sendWindow?: SendWindow | null;
  },
) {
  const row = await db.query.automation.findFirst({
    where: and(eq(automation.id, id), eq(automation.organizationId, orgId)),
  });
  if (!row) throw new Error("No such automation");

  if (input.listId) {
    const list = await db.query.mailingList.findFirst({
      where: and(eq(mailingList.id, input.listId), eq(mailingList.organizationId, orgId)),
      columns: { id: true },
    });
    if (!list) throw new Error("No such list");
  }

  const trigger = input.trigger ?? row.trigger;
  const listId = input.listId === undefined ? row.listId : input.listId;

  /*
   * A segment belongs to one list, so moving the list drops a narrowing that
   * now asks about the wrong people. Silently keeping it would mean a flow
   * that enrols nobody and says nothing about why.
   */
  let segmentId = input.segmentId === undefined ? row.segmentId : input.segmentId;
  if (segmentId) {
    const narrowing = await db.query.segment.findFirst({
      where: and(eq(segment.id, segmentId), eq(segment.organizationId, orgId)),
      columns: { id: true, listId: true },
    });
    if (!narrowing) throw new Error("No such segment");
    if (narrowing.listId !== listId) {
      if (input.segmentId) throw new Error("That segment is about a different list");
      segmentId = null;
    }
  }
  /* An event name is normalised the same way the API normalises an arriving
     one, or the two would never meet. */
  const eventName =
    input.eventName === undefined
      ? row.eventName
      : input.eventName
        ? normaliseEventName(input.eventName)
        : null;

  /* The way out is about the same people as the way in, so it is checked
     the same way. */
  let exitSegmentId = input.exitSegmentId === undefined ? row.exitSegmentId : input.exitSegmentId;
  if (exitSegmentId) {
    const goal = await db.query.segment.findFirst({
      where: and(eq(segment.id, exitSegmentId), eq(segment.organizationId, orgId)),
      columns: { id: true, listId: true },
    });
    if (!goal) throw new Error("No such segment");
    if (goal.listId !== listId) {
      if (input.exitSegmentId) throw new Error("That segment is about a different list");
      exitSegmentId = null;
    }
  }

  const exitEventName =
    input.exitEventName === undefined
      ? row.exitEventName
      : input.exitEventName
        ? normaliseEventName(input.exitEventName)
        : null;

  /*
   * Turning one on with an empty canvas would enrol everybody into nothing
   * and mark them done, which quietly means they can never be enrolled again
   * once it is written. Refused here rather than handled in the runner, and
   * with it the two ways a trigger can be half-answered.
   */
  if (input.status === "active") {
    // The one place an address stops being optional.
    if (!(input.mailboxId ?? row.mailboxId)) {
      throw new Error("Choose an address for this automation to send from first");
    }
    // No list is allowed: it means any list.
    if (!trigger) throw new Error("Choose what starts this automation first");
    if (trigger === "event" && !eventName) throw new Error("Choose which event starts it");
    if (!row.entryNodeId) throw new Error("Put something on the canvas first");
  }

  await db
    .update(automation)
    .set({
      name: input.name?.trim() || row.name,
      mailboxId: input.mailboxId ?? row.mailboxId,
      status: input.status ?? row.status,
      trigger,
      listId,
      eventName,
      segmentId,
      exitSegmentId,
      exitEventName,
      sendWindow: input.sendWindow === undefined ? row.sendWindow : checkWindow(input.sendWindow),
    })
    .where(eq(automation.id, row.id));
}

/**
 * A window the runner can trust, or a reason it cannot be saved.
 *
 * Every field is checked, because the runner reads this on every email and a
 * time zone it cannot parse would throw there instead of here.
 */
function checkWindow(window: SendWindow | null): SendWindow | null {
  if (!window) return null;
  const hour = (value: unknown) =>
    Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 24;
  if (!hour(window.from) || !hour(window.to)) throw new Error("Hours run from 0 to 24");
  const days = [...new Set(window.days)].filter(
    (day) => Number.isInteger(day) && day >= 0 && day <= 6,
  );
  if (days.length === 0) throw new Error("Pick at least one day to send on");
  if (!isTimeZone(window.timeZone)) throw new Error("That time zone is not one this server knows");
  return {
    from: window.from % 24,
    to: window.to % 24,
    days: days.sort(),
    timeZone: window.timeZone,
  };
}

export async function removeAutomation(orgId: string, id: string) {
  await db
    .delete(automation)
    .where(and(eq(automation.id, id), eq(automation.organizationId, orgId)));
}

/* -------------------------------------------------------------------------- */
/* Nodes                                                                      */
/* -------------------------------------------------------------------------- */

/** What a fresh node of each kind starts out as. */
const BLANK: Record<AutomationNodeKind, Partial<typeof automationNode.$inferInsert>> = {
  email: { subject: "Untitled" },
  wait: { delayMinutes: 1440 },
  condition: { config: { test: "opened" } },
  field: { config: { field: "", value: "" } },
  tag: { config: { tagAction: "add", tag: "" } },
  move: { config: { listAction: "copy", listId: "" } },
  unsubscribe: {},
  split: { config: { percent: 50 } },
  // Three days is how long most "did they buy" questions are worth waiting.
  await: { delayMinutes: 4320, config: { event: "" } },
  webhook: { config: { url: "" } },
};

/**
 * Puts a node into the flow on a particular edge.
 *
 * `after` and `branch` name the arrow it goes on, and the node that arrow
 * pointed at becomes the new node's own `next`. That is what makes inserting
 * in the middle work without anybody having to reconnect anything — and why
 * there is no way to leave a node floating unattached.
 *
 * No `after` means the top of the flow: the automation's entry point moves to
 * the new node and the old entry hangs off it.
 */
export async function addNode(
  orgId: string,
  automationId: string,
  input: { kind: AutomationNodeKind; after?: string | null; branch?: "next" | "nextElse" },
) {
  const row = await db.query.automation.findFirst({
    where: and(eq(automation.id, automationId), eq(automation.organizationId, orgId)),
  });
  if (!row) throw new Error("No such automation");

  const branch = input.branch ?? "next";
  let following: string | null = null;

  if (input.after) {
    const parent = await db.query.automationNode.findFirst({
      where: and(eq(automationNode.id, input.after), eq(automationNode.automationId, automationId)),
    });
    if (!parent) throw new Error("No such node");
    following = branch === "nextElse" ? parent.nextElse : parent.next;
  } else {
    following = row.entryNodeId;
  }

  const id = newId("atn");
  await db.insert(automationNode).values({
    id,
    automationId,
    kind: input.kind,
    next: following,
    ...BLANK[input.kind],
  });

  if (input.after) {
    await db
      .update(automationNode)
      .set(branch === "nextElse" ? { nextElse: id } : { next: id })
      .where(eq(automationNode.id, input.after));
  } else {
    await db.update(automation).set({ entryNodeId: id }).where(eq(automation.id, automationId));
  }

  // The secret a webhook box signs with, made the first time one is needed.
  if (input.kind === "webhook" && !row.webhookSecret) {
    await db
      .update(automation)
      .set({ webhookSecret: makeWebhookSecret() })
      .where(eq(automation.id, automationId));
  }

  return id;
}

export async function updateNode(
  orgId: string,
  nodeId: string,
  input: {
    subject?: string;
    delayMinutes?: number;
    /** A moment, or null to go back to a length of time. */
    waitUntil?: Date | null;
    config?: NodeConfig;
    design?: EmailDesign | null;
    html?: string | null;
    text?: string | null;
    /** Start this email from a saved template: its subject and blocks are copied. */
    templateId?: string | null;
  },
) {
  const node = await nodeOf(orgId, nodeId);
  if (!node) throw new Error("No such node");

  /*
   * A template is copied, not referenced — the same rule a campaign follows.
   * Pointing at it would mean the flow changes every time somebody fixes a
   * typo in the template for something else, which is not what anybody means
   * by "start from this one".
   */
  if (input.templateId) {
    const { findTemplate } = await import("./templates");
    const from = await findTemplate(orgId, input.templateId);
    if (!from) throw new Error("No such template");

    await db
      .update(automationNode)
      .set({
        subject: input.subject?.trim() || from.subject || node.subject,
        html: from.html,
        text: from.text,
        design: from.design,
      })
      .where(eq(automationNode.id, nodeId));
    return;
  }

  let config = input.config;
  if (config && node.kind === "await") {
    // Normalised the way an arriving event is, or the two would never meet.
    config = { ...config, event: config.event ? normaliseEventName(config.event) : "" };
  }
  if (config && node.kind === "webhook" && config.url?.trim()) {
    const checked = checkWebhookUrl(config.url);
    if (!checked.ok) throw new Error(checked.reason);
    config = { ...config, url: checked.url.toString() };
  }
  if (config && node.kind === "split") {
    const share = Math.round(Number(config.percent ?? 50));
    config = { ...config, percent: Number.isFinite(share) ? Math.min(99, Math.max(1, share)) : 50 };
  }

  // Same rule as everywhere else: a design decides the body, compiled here so
  // the canvas and what goes out cannot disagree.
  const body = input.design
    ? { html: renderDesign(input.design, env.appUrl), text: designToText(input.design) }
    : { html: input.html, text: input.text };

  const delayMinutes =
    input.delayMinutes === undefined
      ? node.delayMinutes
      : Math.max(node.kind === "await" ? 1 : 0, Math.round(input.delayMinutes));
  const waitUntil = input.waitUntil === undefined ? node.waitUntil : input.waitUntil;

  await db
    .update(automationNode)
    .set({
      subject: input.subject?.trim() || node.subject,
      delayMinutes,
      waitUntil,
      config: config === undefined ? node.config : config,
      html: body.html === undefined ? node.html : (body.html ?? null),
      text: body.text === undefined ? node.text : (body.text ?? null),
      design: input.design === undefined ? node.design : input.design,
    })
    .where(eq(automationNode.id, nodeId));

  /*
   * People already sitting on the box follow the new setting.
   *
   * Otherwise changing "wait 3 days" to "wait 1 day" only reaches the people
   * who arrive afterwards, and the ones who were already waiting sit out the
   * old length — which is not what anybody means by changing it.
   */
  const timing = input.delayMinutes !== undefined || input.waitUntil !== undefined;
  if (timing && (node.kind === "wait" || node.kind === "await")) {
    await db
      .update(automationRun)
      .set({
        nextAt:
          node.kind === "wait" && waitUntil
            ? waitUntil
            : sql`${automationRun.parkedAt} + make_interval(mins => ${delayMinutes})`,
      })
      .where(
        and(
          eq(automationRun.nodeId, nodeId),
          eq(automationRun.status, "active"),
          sql`${automationRun.parkedAt} is not null`,
        ),
      );
  }
}

/**
 * Takes a node out and joins the flow back up around it.
 *
 * Whatever pointed at it now points at whatever it pointed at, so removing
 * something from the middle does not sever everything below. A condition is
 * the one case with a choice to make: its "no" branch has nowhere to go once
 * the condition is gone, so that whole branch is deleted with it — and the
 * dialog that offers this says so.
 */
export async function removeNode(orgId: string, nodeId: string) {
  const node = await nodeOf(orgId, nodeId);
  if (!node) return;

  const doomed =
    forks(node.kind) && node.nextElse
      ? await descendants(node.automationId, node.nextElse)
      : new Set<string>();

  await db
    .update(automationNode)
    .set({ next: node.next })
    .where(
      and(eq(automationNode.automationId, node.automationId), eq(automationNode.next, nodeId)),
    );
  await db
    .update(automationNode)
    .set({ nextElse: node.next })
    .where(
      and(eq(automationNode.automationId, node.automationId), eq(automationNode.nextElse, nodeId)),
    );

  await db
    .update(automation)
    .set({ entryNodeId: node.next })
    .where(and(eq(automation.id, node.automationId), eq(automation.entryNodeId, nodeId)));

  /*
   * Anybody sitting on this node moves to the one after it rather than being
   * stranded. Done before the delete so the pointer is never dangling.
   */
  await db
    .update(automationRun)
    .set({ nodeId: node.next, nextAt: new Date(), parkedAt: null, attempts: 0 })
    .where(eq(automationRun.nodeId, nodeId));

  await db.delete(automationNode).where(eq(automationNode.id, nodeId));

  for (const id of doomed) {
    await db
      .update(automationRun)
      .set({ status: "stopped", stoppedReason: "That branch was deleted" })
      .where(eq(automationRun.nodeId, id));
    await db.delete(automationNode).where(eq(automationNode.id, id));
  }
}

/** Everything reachable from one node, for deleting a branch whole. */
async function descendants(automationId: string, from: string) {
  const all = await db
    .select()
    .from(automationNode)
    .where(eq(automationNode.automationId, automationId));
  const by = new Map(all.map((node) => [node.id, node]));

  const found = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const id = queue.pop();
    if (!id || found.has(id)) continue;
    found.add(id);
    const node = by.get(id);
    if (node?.next) queue.push(node.next);
    if (node?.nextElse) queue.push(node.nextElse);
  }
  return found;
}

async function nodeOf(orgId: string, nodeId: string) {
  const [row] = await db
    .select({
      id: automationNode.id,
      automationId: automationNode.automationId,
      kind: automationNode.kind,
      subject: automationNode.subject,
      delayMinutes: automationNode.delayMinutes,
      waitUntil: automationNode.waitUntil,
      config: automationNode.config,
      html: automationNode.html,
      text: automationNode.text,
      design: automationNode.design,
      next: automationNode.next,
      nextElse: automationNode.nextElse,
    })
    .from(automationNode)
    .innerJoin(automation, eq(automation.id, automationNode.automationId))
    .where(and(eq(automationNode.id, nodeId), eq(automation.organizationId, orgId)))
    .limit(1);
  return row ?? null;
}

/**
 * How each email box has done.
 *
 * The number a flow is judged by is per box, not per flow: "the second one
 * gets half the opens of the first" is the sentence somebody is trying to
 * write, and until this existed there was nothing to write it from.
 */
export interface StepTally {
  sent: number;
  opened: number;
  clicked: number;
}

export async function stepTallies(orgId: string, automationId: string) {
  const rows = await db
    .select({
      nodeId: automationSend.nodeId,
      sent: count(),
      opened: sql<number>`count(${automationSend.openedAt})::int`,
      clicked: sql<number>`count(${automationSend.clickedAt})::int`,
    })
    .from(automationSend)
    .where(
      and(eq(automationSend.organizationId, orgId), eq(automationSend.automationId, automationId)),
    )
    .groupBy(automationSend.nodeId);

  const out: Record<string, StepTally> = {};
  for (const row of rows) {
    if (!row.nodeId) continue;
    out[row.nodeId] = { sent: row.sent, opened: row.opened, clicked: row.clicked };
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The list of them                                                           */
/* -------------------------------------------------------------------------- */

export interface AutomationRow {
  id: string;
  name: string;
  /** Null until a trigger has been chosen on the canvas. */
  trigger: AutomationTrigger | null;
  eventName: string | null;
  /** What it is narrowed to, if anything. */
  segmentName: string | null;
  listId: string | null;
  listName: string | null;
  /** Null until an address has been chosen for it. */
  from: string | null;
  status: AutomationStatus;
  /** How many boxes are on the canvas, of every kind. */
  steps: number;
  /** People part-way through it right now. */
  running: number;
  finished: number;
  createdAt: Date;
}

export async function automationsView(
  orgId: string,
  only: "all" | string[] = "all",
): Promise<AutomationRow[]> {
  const rows = await db
    .select({
      id: automation.id,
      name: automation.name,
      trigger: automation.trigger,
      eventName: automation.eventName,
      segmentName: segment.name,
      listId: automation.listId,
      listName: mailingList.name,
      from: mailbox.address,
      status: automation.status,
      createdAt: automation.createdAt,
    })
    .from(automation)
    // Left, because an automation exists before its trigger does: a new one
    // has no list until somebody picks one on the canvas.
    .leftJoin(mailingList, eq(mailingList.id, automation.listId))
    .leftJoin(segment, eq(segment.id, automation.segmentId))
    // Left, for the same reason: a campaigns-only instance has no mailboxes,
    // and an inner join here made every automation on one invisible.
    .leftJoin(mailbox, eq(mailbox.id, automation.mailboxId))
    .where(
      only === "all"
        ? eq(automation.organizationId, orgId)
        : and(
            eq(automation.organizationId, orgId),
            // A flow that has not been pointed at a list yet has no audience
            // to protect, and hiding it would hide the one somebody is drawing.
            or(
              isNull(automation.listId),
              only.length > 0 ? inArray(automation.listId, only) : sql`false`,
            ),
          ),
    )
    .orderBy(asc(automation.name));

  if (rows.length === 0) return [];

  const [steps, runs] = await Promise.all([
    db
      .select({ automationId: automationNode.automationId, howMany: count() })
      .from(automationNode)
      .groupBy(automationNode.automationId),
    db
      .select({
        automationId: automationRun.automationId,
        status: automationRun.status,
        howMany: count(),
      })
      .from(automationRun)
      .where(eq(automationRun.organizationId, orgId))
      .groupBy(automationRun.automationId, automationRun.status),
  ]);

  return rows.map((row) => {
    const mine = runs.filter((entry) => entry.automationId === row.id);
    return {
      ...row,
      steps: steps.find((entry) => entry.automationId === row.id)?.howMany ?? 0,
      running: mine.find((entry) => entry.status === "active")?.howMany ?? 0,
      finished: mine.find((entry) => entry.status === "done")?.howMany ?? 0,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Copying one                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A second automation with the same canvas, as a draft.
 *
 * Nobody from the first one comes along: the copy is somewhere to change
 * one thing and try it, and a copy that started life with people already in
 * it would be sending before anybody had looked at it.
 */
export async function duplicateAutomation(orgId: string, id: string) {
  const original = await findAutomation(orgId, id);
  if (!original) throw new Error("No such automation");

  const copyId = newId("aut");
  await db.insert(automation).values({
    id: copyId,
    organizationId: orgId,
    name: `${original.name} (copy)`,
    listId: original.listId,
    mailboxId: original.mailboxId,
    trigger: original.trigger,
    eventName: original.eventName,
    segmentId: original.segmentId,
    exitSegmentId: original.exitSegmentId,
    exitEventName: original.exitEventName,
    sendWindow: original.sendWindow,
    // A secret of its own: a receiver that trusts one flow has not agreed to
    // trust every copy of it.
    webhookSecret: original.webhookSecret ? makeWebhookSecret() : null,
    status: "draft",
  });

  if (original.nodes.length === 0) return copyId;

  /*
   * Every box gets a new id, and every arrow is pointed at the new ids.
   * Inserted with no arrows first, because an arrow may point at a box that
   * is further down the list and does not exist yet.
   */
  const renamed = new Map(original.nodes.map((node) => [node.id, newId("atn")]));
  const moved = (from: string | null) => (from ? (renamed.get(from) ?? null) : null);

  await db.insert(automationNode).values(
    original.nodes.map((node) => ({
      id: renamed.get(node.id) as string,
      automationId: copyId,
      kind: node.kind,
      subject: node.subject,
      html: node.html,
      text: node.text,
      design: node.design,
      delayMinutes: node.delayMinutes,
      waitUntil: node.waitUntil,
      config: node.config,
      createdAt: node.createdAt,
    })),
  );
  for (const node of original.nodes) {
    if (!node.next && !node.nextElse) continue;
    await db
      .update(automationNode)
      .set({ next: moved(node.next), nextElse: moved(node.nextElse) })
      .where(eq(automationNode.id, renamed.get(node.id) as string));
  }
  await db
    .update(automation)
    .set({ entryNodeId: moved(original.entryNodeId) })
    .where(eq(automation.id, copyId));

  return copyId;
}

/* -------------------------------------------------------------------------- */
/* Who is in it                                                               */
/* -------------------------------------------------------------------------- */

/** How many people are on each box right now, by node id. */
export async function stepPositions(orgId: string, automationId: string) {
  const rows = await db
    .select({ nodeId: automationRun.nodeId, howMany: count() })
    .from(automationRun)
    .where(
      and(
        eq(automationRun.organizationId, orgId),
        eq(automationRun.automationId, automationId),
        eq(automationRun.status, "active"),
      ),
    )
    .groupBy(automationRun.nodeId);

  const out: Record<string, number> = {};
  for (const row of rows) if (row.nodeId) out[row.nodeId] = row.howMany;
  return out;
}

export interface PersonInFlow {
  runId: string;
  memberId: string;
  address: string;
  name: string | null;
  status: "active" | "done" | "stopped";
  nodeId: string | null;
  /** When the box they are on is due. Only meaningful while active. */
  nextAt: Date;
  /** True while they are sitting on a wait rather than due to do something. */
  parked: boolean;
  attempts: number;
  /** Why they stopped, or what went wrong on the last try. */
  reason: string | null;
  startedAt: Date;
  sends: {
    nodeId: string | null;
    subject: string | null;
    sentAt: Date;
    opened: boolean;
    clicked: boolean;
  }[];
}

export const PEOPLE_PAGE = 50;

/**
 * The people in a flow, newest first, with what it has sent each of them.
 *
 * The count on the canvas says how many; this says who, and why somebody
 * stopped — the question after "why did they not get the second email".
 */
export async function automationPeople(
  orgId: string,
  automationId: string,
  filter: {
    status?: "active" | "done" | "stopped";
    nodeId?: string;
    search?: string;
    page?: number;
  },
): Promise<{ people: PersonInFlow[]; total: number; counts: Record<string, number> }> {
  const where = and(
    eq(automationRun.organizationId, orgId),
    eq(automationRun.automationId, automationId),
    filter.status ? eq(automationRun.status, filter.status) : undefined,
    filter.nodeId ? eq(automationRun.nodeId, filter.nodeId) : undefined,
    filter.search?.trim() ? ilike(listMember.address, `%${filter.search.trim()}%`) : undefined,
  );
  const page = Math.max(0, filter.page ?? 0);

  const [rows, [total], byStatus] = await Promise.all([
    db
      .select({
        runId: automationRun.id,
        memberId: listMember.id,
        address: listMember.address,
        name: listMember.name,
        status: automationRun.status,
        nodeId: automationRun.nodeId,
        nextAt: automationRun.nextAt,
        parkedAt: automationRun.parkedAt,
        attempts: automationRun.attempts,
        reason: automationRun.stoppedReason,
        startedAt: automationRun.createdAt,
      })
      .from(automationRun)
      .innerJoin(listMember, eq(listMember.id, automationRun.listMemberId))
      .where(where)
      .orderBy(desc(automationRun.createdAt))
      .limit(PEOPLE_PAGE)
      .offset(page * PEOPLE_PAGE),
    db
      .select({ howMany: count() })
      .from(automationRun)
      .innerJoin(listMember, eq(listMember.id, automationRun.listMemberId))
      .where(where),
    db
      .select({ status: automationRun.status, howMany: count() })
      .from(automationRun)
      .where(
        and(eq(automationRun.organizationId, orgId), eq(automationRun.automationId, automationId)),
      )
      .groupBy(automationRun.status),
  ]);

  const sends =
    rows.length === 0
      ? []
      : await db
          .select({
            memberId: automationSend.listMemberId,
            nodeId: automationSend.nodeId,
            subject: automationSend.subject,
            sentAt: automationSend.sentAt,
            openedAt: automationSend.openedAt,
            clickedAt: automationSend.clickedAt,
          })
          .from(automationSend)
          .where(
            and(
              eq(automationSend.automationId, automationId),
              inArray(
                automationSend.listMemberId,
                rows.map((row) => row.memberId),
              ),
            ),
          )
          .orderBy(asc(automationSend.sentAt));

  return {
    people: rows.map((row) => ({
      runId: row.runId,
      memberId: row.memberId,
      address: row.address,
      name: row.name,
      status: row.status,
      nodeId: row.nodeId,
      nextAt: row.nextAt,
      parked: row.parkedAt !== null,
      attempts: row.attempts,
      reason: row.reason,
      startedAt: row.startedAt,
      sends: sends
        .filter((send) => send.memberId === row.memberId)
        .map((send) => ({
          nodeId: send.nodeId,
          subject: send.subject,
          sentAt: send.sentAt,
          opened: send.openedAt !== null,
          clicked: send.clickedAt !== null,
        })),
    })),
    total: total?.howMany ?? 0,
    counts: Object.fromEntries(byStatus.map((row) => [row.status, row.howMany])),
  };
}

/**
 * Takes one person out of a flow by hand.
 *
 * Marked stopped rather than deleted, the same as every other way out, so
 * the record of how far they got survives — and so a joining trigger does
 * not see them as new and put them straight back in.
 */
export async function stopRun(orgId: string, automationId: string, runId: string) {
  await db
    .update(automationRun)
    .set({ status: "stopped", stoppedReason: "Taken out by hand", parkedAt: null })
    .where(
      and(
        eq(automationRun.id, runId),
        eq(automationRun.organizationId, orgId),
        eq(automationRun.automationId, automationId),
        eq(automationRun.status, "active"),
      ),
    );
}
