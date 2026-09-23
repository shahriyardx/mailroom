import "server-only";
import { db } from "@/db";
import {
  type CustomEvent,
  automation,
  automationRun,
  customEvent,
  listMember,
  mailingList,
  segment,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { and, asc, eq, sql } from "drizzle-orm";
import { subscribe } from "./campaigns";
import { segmentCondition } from "./segments";

/**
 * Events your own code posts, and the automations waiting for them.
 *
 * The other trigger — joining a list — is something this app can see for
 * itself. Everything else a product wants to say is something only the
 * product knows: a trial ended, an order shipped, a card was declined. So it
 * arrives as one POST with a name and an address, and whatever is listening
 * for that name starts running for that person.
 *
 * Names are registered rather than free text. Not to refuse the unknown ones
 * — an unknown name is recorded exactly like a known one — but because a
 * mistyped string sent from a server somewhere is otherwise invisible, and
 * "the flow did not run" has no way to distinguish "nothing arrived" from
 * "something arrived spelled differently".
 */

/**
 * Lowercase, and only the punctuation that reads as a name.
 *
 * `Trial.Ended ` and `trial.ended` are the same event, and finding out
 * otherwise in production is an afternoon nobody gets back.
 */
export function normaliseEventName(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 60);
}

export interface EventRow extends CustomEvent {
  /** Automations triggered by this name, and how many are switched on. */
  usedBy: number;
  liveUsedBy: number;
}

export async function eventsView(orgId: string): Promise<EventRow[]> {
  const [rows, uses] = await Promise.all([
    db
      .select()
      .from(customEvent)
      .where(eq(customEvent.organizationId, orgId))
      .orderBy(asc(customEvent.name)),
    db
      .select({
        name: automation.eventName,
        status: automation.status,
      })
      .from(automation)
      .where(and(eq(automation.organizationId, orgId), eq(automation.trigger, "event"))),
  ]);

  return rows.map((row) => {
    const mine = uses.filter((entry) => entry.name === row.name);
    return {
      ...row,
      usedBy: mine.length,
      liveUsedBy: mine.filter((entry) => entry.status === "active").length,
    };
  });
}

export async function createEvent(
  orgId: string,
  input: { name: string; description?: string | null },
) {
  const name = normaliseEventName(input.name);
  if (!name) throw new Error("Give the event a name");

  const existing = await db.query.customEvent.findFirst({
    where: and(eq(customEvent.organizationId, orgId), eq(customEvent.name, name)),
  });

  /*
   * A name the API already posted is declared rather than duplicated. That is
   * the normal way one of these gets made: somebody wires up the call first,
   * sees it arrive here, and then writes down what it means.
   */
  if (existing) {
    await db
      .update(customEvent)
      .set({ declared: true, description: input.description ?? existing.description })
      .where(eq(customEvent.id, existing.id));
    return existing.id;
  }

  const id = newId("evt");
  await db.insert(customEvent).values({
    id,
    organizationId: orgId,
    name,
    description: input.description ?? null,
    declared: true,
  });
  return id;
}

export async function updateEvent(
  orgId: string,
  id: string,
  input: { description?: string | null },
) {
  await db
    .update(customEvent)
    .set({ description: input.description ?? null })
    .where(and(eq(customEvent.id, id), eq(customEvent.organizationId, orgId)));
}

/**
 * Forgets a name. The automations listening for it are left alone — they stop
 * matching, they do not break — so deleting one is not a way to quietly
 * change what a live flow does.
 */
export async function removeEvent(orgId: string, id: string) {
  await db
    .delete(customEvent)
    .where(and(eq(customEvent.id, id), eq(customEvent.organizationId, orgId)));
}

/* -------------------------------------------------------------------------- */
/* Receiving one                                                              */
/* -------------------------------------------------------------------------- */

export interface EventOutcome {
  automationId: string;
  automation: string;
  /**
   * What happened to this person in this flow.
   *
   * "started" and "restarted" are the two ways somebody begins. The rest are
   * reasons they did not, reported rather than swallowed: an event that
   * silently does nothing is the hardest kind of thing to debug from outside.
   */
  status: "started" | "restarted" | "already_running" | "skipped";
  reason?: string;
}

export interface EventReceipt {
  event: string;
  /** False when nobody had declared this name before it arrived. */
  declared: boolean;
  matched: EventOutcome[];
}

export interface EventInput {
  name: string;
  address: string;
  personName?: string | null;
  /** Merged onto the person, so a later condition or subject can read them. */
  fields?: Record<string, string>;
  /**
   * Where consent came from, for somebody not on the list yet.
   *
   * Required to add anybody: an event arriving with an address is not the
   * same as that person asking for mail, and this app does not invent the
   * answer to "why are you emailing me". Without it an unknown address is
   * reported as skipped rather than quietly subscribed.
   */
  consentSource?: string | null;
}

/**
 * Records an event and starts whatever is waiting for it.
 *
 * Runs are started here rather than swept up by the worker, because the
 * difference between the two triggers is exactly this: joining a list is a
 * state the sweep can notice afterwards, while an event is a moment that has
 * to be caught when it happens.
 */
export async function emitEvent(orgId: string, input: EventInput): Promise<EventReceipt> {
  const name = normaliseEventName(input.name);
  if (!name) throw new Error("Give the event a name");

  const address = input.address.trim().toLowerCase();
  if (!address.includes("@")) throw new Error("That is not an email address");

  const known = await db.query.customEvent.findFirst({
    where: and(eq(customEvent.organizationId, orgId), eq(customEvent.name, name)),
  });

  const seen = {
    seenCount: (known?.seenCount ?? 0) + 1,
    lastSeenAt: new Date(),
    lastPayload: {
      email: address,
      ...(input.personName ? { name: input.personName } : {}),
      ...(input.fields ? { fields: input.fields } : {}),
    } as Record<string, unknown>,
  };

  if (known) {
    await db.update(customEvent).set(seen).where(eq(customEvent.id, known.id));
  } else {
    // Recorded undeclared rather than refused. A name nobody wrote down is
    // the single most likely reason a flow did not run, and it can only be
    // seen if it is kept.
    await db
      .insert(customEvent)
      .values({ id: newId("evt"), organizationId: orgId, name, declared: false, ...seen })
      .onConflictDoNothing();
  }

  const waiting = await db
    .select({
      id: automation.id,
      name: automation.name,
      listId: automation.listId,
      segmentId: automation.segmentId,
      entryNodeId: automation.entryNodeId,
    })
    .from(automation)
    .where(
      and(
        eq(automation.organizationId, orgId),
        eq(automation.trigger, "event"),
        eq(automation.eventName, name),
        eq(automation.status, "active"),
      ),
    );

  const matched: EventOutcome[] = [];

  for (const job of waiting) {
    if (!job.listId || !job.entryNodeId) {
      matched.push({
        automationId: job.id,
        automation: job.name,
        status: "skipped",
        reason: "That automation has nothing on its canvas",
      });
      continue;
    }

    const outcome = await startOne(orgId, job as Ready, { ...input, address });
    matched.push({ automationId: job.id, automation: job.name, ...outcome });
  }

  return { event: name, declared: known?.declared ?? false, matched };
}

interface Ready {
  id: string;
  name: string;
  listId: string;
  segmentId: string | null;
  entryNodeId: string;
}

async function startOne(
  orgId: string,
  job: Ready,
  input: EventInput & { address: string },
): Promise<{ status: EventOutcome["status"]; reason?: string }> {
  let member = await db.query.listMember.findFirst({
    where: and(eq(listMember.listId, job.listId), eq(listMember.address, input.address)),
    columns: { id: true, status: true, fields: true },
  });

  if (!member) {
    if (!input.consentSource) {
      const list = await db.query.mailingList.findFirst({
        where: eq(mailingList.id, job.listId),
        columns: { name: true },
      });
      return {
        status: "skipped",
        reason: `Not on ${list?.name ?? "the list"}. Send consent_source to add them.`,
      };
    }

    const added = await subscribe(
      orgId,
      job.listId,
      { address: input.address, name: input.personName, fields: input.fields },
      input.consentSource,
    );
    if (added.status === "blocked") {
      return { status: "skipped", reason: "That address bounced or reported a message" };
    }
    if (added.status === "pending") {
      // A double opt-in list means they are not a subscriber yet. Starting a
      // flow for somebody who has not confirmed is the exact thing that
      // setting exists to prevent.
      return { status: "skipped", reason: "Waiting for them to confirm their subscription" };
    }

    member = await db.query.listMember.findFirst({
      where: eq(listMember.id, added.id),
      columns: { id: true, status: true, fields: true },
    });
    if (!member) return { status: "skipped", reason: "They could not be added to the list" };
  }

  if (member.status !== "subscribed") {
    return { status: "skipped", reason: `They are ${member.status}` };
  }

  /*
   * What came with the event is written onto the person before anything else
   * looks at them, so the first email can say the order number and the first
   * condition can read the plan. Merged, not replaced: an event about one
   * thing must not wipe what is known about everything else.
   *
   * Before the segment is asked, deliberately. A flow narrowed to "plan is
   * pro" must start for somebody the same call has just made pro.
   */
  if (input.fields && Object.keys(input.fields).length > 0) {
    await db
      .update(listMember)
      .set({ fields: { ...member.fields, ...input.fields } })
      .where(eq(listMember.id, member.id));
  }

  /*
   * A narrowing is asked here rather than kept as a membership, so it is
   * true on the day the event arrives.
   */
  if (job.segmentId) {
    const narrowing = await db.query.segment.findFirst({
      where: eq(segment.id, job.segmentId),
    });
    if (narrowing) {
      const [match] = await db
        .select({ id: listMember.id })
        .from(listMember)
        .where(and(eq(listMember.id, member.id), segmentCondition(narrowing)))
        .limit(1);
      if (!match) {
        return { status: "skipped", reason: `Not in "${narrowing.name}"` };
      }
    }
  }

  const already = await db.query.automationRun.findFirst({
    where: and(eq(automationRun.automationId, job.id), eq(automationRun.listMemberId, member.id)),
  });

  if (already?.status === "active") {
    // Two copies of the same flow racing each other would send the same
    // person the same series twice, interleaved. One at a time.
    return { status: "already_running" };
  }

  if (already) {
    await db
      .update(automationRun)
      .set({
        status: "active",
        nodeId: job.entryNodeId,
        nextAt: new Date(),
        stoppedReason: null,
      })
      .where(eq(automationRun.id, already.id));
    return { status: "restarted" };
  }

  await db.insert(automationRun).values({
    id: newId("aur"),
    organizationId: orgId,
    automationId: job.id,
    listMemberId: member.id,
    nodeId: job.entryNodeId,
    nextAt: new Date(),
  });
  return { status: "started" };
}

/** How many events have arrived, for the overview. */
export async function eventCount(orgId: string) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${customEvent.seenCount}), 0)::int` })
    .from(customEvent)
    .where(eq(customEvent.organizationId, orgId));
  return row?.total ?? 0;
}
