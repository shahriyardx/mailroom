import "server-only";
import { db } from "@/db";
import {
  type AutomationNodeKind,
  type AutomationStatus,
  type NodeConfig,
  automation,
  automationNode,
  automationRun,
  mailbox,
  mailingList,
} from "@/db/schema";
import { type EmailDesign, designToText, renderDesign } from "@/lib/email-blocks";
import { env } from "@/lib/env";
import { newId } from "@/lib/utils";
import { and, asc, count, eq, sql } from "drizzle-orm";

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

export async function createAutomation(
  orgId: string,
  input: { listId: string; mailboxId: string; name: string },
) {
  const name = input.name.trim();
  if (!name) throw new Error("Give the automation a name");

  const [list, box] = await Promise.all([
    db.query.mailingList.findFirst({
      where: and(eq(mailingList.id, input.listId), eq(mailingList.organizationId, orgId)),
      columns: { id: true },
    }),
    db.query.mailbox.findFirst({
      where: and(eq(mailbox.id, input.mailboxId), eq(mailbox.organizationId, orgId)),
      columns: { id: true },
    }),
  ]);
  if (!list) throw new Error("No such list");
  if (!box) throw new Error("No such mailbox");

  const id = newId("aut");
  await db.insert(automation).values({
    id,
    organizationId: orgId,
    listId: input.listId,
    mailboxId: input.mailboxId,
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
  input: { name?: string; mailboxId?: string; status?: AutomationStatus },
) {
  const row = await db.query.automation.findFirst({
    where: and(eq(automation.id, id), eq(automation.organizationId, orgId)),
  });
  if (!row) throw new Error("No such automation");

  /*
   * Turning one on with an empty canvas would enrol everybody into nothing
   * and mark them done, which quietly means they can never be enrolled again
   * once it is written. Refused here rather than handled in the runner.
   */
  if (input.status === "active" && !row.entryNodeId) {
    throw new Error("Put something on the canvas first");
  }

  await db
    .update(automation)
    .set({
      name: input.name?.trim() || row.name,
      mailboxId: input.mailboxId ?? row.mailboxId,
      status: input.status ?? row.status,
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

/* -------------------------------------------------------------------------- */
/* The list of them                                                           */
/* -------------------------------------------------------------------------- */

export interface AutomationRow {
  id: string;
  name: string;
  listId: string;
  listName: string;
  from: string;
  status: AutomationStatus;
  /** How many boxes are on the canvas, of every kind. */
  steps: number;
  /** People part-way through it right now. */
  running: number;
  finished: number;
  createdAt: Date;
}

export async function automationsView(orgId: string): Promise<AutomationRow[]> {
  const rows = await db
    .select({
      id: automation.id,
      name: automation.name,
      listId: automation.listId,
      listName: mailingList.name,
      from: mailbox.address,
      status: automation.status,
      createdAt: automation.createdAt,
    })
    .from(automation)
    .innerJoin(mailingList, eq(mailingList.id, automation.listId))
    .innerJoin(mailbox, eq(mailbox.id, automation.mailboxId))
    .where(eq(automation.organizationId, orgId))
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
