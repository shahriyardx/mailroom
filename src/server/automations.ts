import "server-only";
import { db } from "@/db";
import {
  type AutomationNodeKind,
  type AutomationStatus,
  type AutomationTrigger,
  type NodeConfig,
  automation,
  automationNode,
  automationRun,
  automationSend,
  mailbox,
  mailingList,
  segment,
} from "@/db/schema";
import { type EmailDesign, designToText, renderDesign } from "@/lib/email-blocks";
import { env } from "@/lib/env";
import { newId } from "@/lib/utils";
import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { normaliseEventName } from "./custom-events";

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
    if (!trigger || !listId) throw new Error("Choose what starts this automation first");
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
    })
    .where(eq(automation.id, row.id));
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

  // Same rule as everywhere else: a design decides the body, compiled here so
  // the canvas and what goes out cannot disagree.
  const body = input.design
    ? { html: renderDesign(input.design, env.appUrl), text: designToText(input.design) }
    : { html: input.html, text: input.text };

  await db
    .update(automationNode)
    .set({
      subject: input.subject?.trim() || node.subject,
      delayMinutes:
        input.delayMinutes === undefined
          ? node.delayMinutes
          : Math.max(0, Math.round(input.delayMinutes)),
      waitUntil: input.waitUntil === undefined ? node.waitUntil : input.waitUntil,
      config: input.config === undefined ? node.config : input.config,
      html: body.html === undefined ? node.html : (body.html ?? null),
      text: body.text === undefined ? node.text : (body.text ?? null),
      design: input.design === undefined ? node.design : input.design,
    })
    .where(eq(automationNode.id, nodeId));
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
    node.kind === "condition" && node.nextElse
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
    .set({ nodeId: node.next, nextAt: new Date() })
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
