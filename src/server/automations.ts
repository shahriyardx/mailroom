import "server-only";
import { db } from "@/db";
import {
  type AutomationStatus,
  automation,
  automationRun,
  automationStep,
  listMember,
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
 * Deliberately a straight line — one trigger, ordered steps, no branching.
 * A welcome series is what almost everybody actually wants, and a flowchart
 * builder is a separate product that would never be finished.
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

  const steps = await db
    .select()
    .from(automationStep)
    .where(eq(automationStep.automationId, id))
    .orderBy(asc(automationStep.position));

  return { ...row, steps };
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
   * Turning one on with no steps would enrol everybody into nothing and mark
   * them done, which quietly means they can never be enrolled again once the
   * steps are written. Refused here rather than handled in the runner.
   */
  if (input.status === "active") {
    const [steps] = await db
      .select({ howMany: count() })
      .from(automationStep)
      .where(eq(automationStep.automationId, id));
    if ((steps?.howMany ?? 0) === 0) throw new Error("Add at least one email first");
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
/* Steps                                                                      */
/* -------------------------------------------------------------------------- */

/** Appends an email to the end of the series. */
export async function addStep(
  orgId: string,
  automationId: string,
  input: { subject: string; delayMinutes?: number },
) {
  const row = await db.query.automation.findFirst({
    where: and(eq(automation.id, automationId), eq(automation.organizationId, orgId)),
    columns: { id: true },
  });
  if (!row) throw new Error("No such automation");

  const [last] = await db
    .select({ howMany: count() })
    .from(automationStep)
    .where(eq(automationStep.automationId, automationId));

  const id = newId("ats");
  await db.insert(automationStep).values({
    id,
    automationId,
    position: last?.howMany ?? 0,
    delayMinutes: Math.max(0, Math.round(input.delayMinutes ?? 0)),
    subject: input.subject.trim() || "Untitled",
  });
  return id;
}

export async function updateStep(
  orgId: string,
  stepId: string,
  input: {
    subject?: string;
    delayMinutes?: number;
    design?: EmailDesign | null;
    html?: string | null;
    text?: string | null;
  },
) {
  const step = await stepOf(orgId, stepId);
  if (!step) throw new Error("No such step");

  // Same rule as everywhere else: a design decides the body, compiled here so
  // the canvas and what goes out cannot disagree.
  const body = input.design
    ? { html: renderDesign(input.design, env.appUrl), text: designToText(input.design) }
    : { html: input.html, text: input.text };

  await db
    .update(automationStep)
    .set({
      subject: input.subject?.trim() || step.subject,
      delayMinutes:
        input.delayMinutes === undefined
          ? step.delayMinutes
          : Math.max(0, Math.round(input.delayMinutes)),
      html: body.html === undefined ? step.html : (body.html ?? null),
      text: body.text === undefined ? step.text : (body.text ?? null),
      design: input.design === undefined ? step.design : input.design,
    })
    .where(eq(automationStep.id, stepId));
}

/**
 * Removes a step and closes the gap.
 *
 * Positions stay contiguous because a run stores the index it is waiting on.
 * A hole in the numbering would strand everybody sitting past it.
 */
export async function removeStep(orgId: string, stepId: string) {
  const step = await stepOf(orgId, stepId);
  if (!step) return;

  await db.delete(automationStep).where(eq(automationStep.id, stepId));
  await db
    .update(automationStep)
    .set({ position: sql`${automationStep.position} - 1` })
    .where(
      and(
        eq(automationStep.automationId, step.automationId),
        sql`${automationStep.position} > ${step.position}`,
      ),
    );
}

async function stepOf(orgId: string, stepId: string) {
  const [row] = await db
    .select({
      id: automationStep.id,
      automationId: automationStep.automationId,
      position: automationStep.position,
      subject: automationStep.subject,
      delayMinutes: automationStep.delayMinutes,
      html: automationStep.html,
      text: automationStep.text,
      design: automationStep.design,
    })
    .from(automationStep)
    .innerJoin(automation, eq(automation.id, automationStep.automationId))
    .where(and(eq(automationStep.id, stepId), eq(automation.organizationId, orgId)))
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
      .select({ automationId: automationStep.automationId, howMany: count() })
      .from(automationStep)
      .groupBy(automationStep.automationId),
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
