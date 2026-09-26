import "server-only";
import { db } from "@/db";
import {
  type AutomationNode,
  type Segment,
  type SendWindow,
  automation,
  automationNode,
  automationRun,
  automationSend,
  listMember,
  segment,
  workspace,
} from "@/db/schema";
import { describeTest, humanDelay, onThe, splitShare } from "@/lib/automation-flow";
import { merge, withFooter } from "@/lib/campaign-body";
import { nextOpening } from "@/lib/send-window";
import { newId } from "@/lib/utils";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { preferencesUrl, subscribe, unsubscribeUrl } from "./campaigns";
import { segmentCondition } from "./segments";
import { deliverMessage } from "./send";
import { sendBudget } from "./send-rate";
import { checkWebhookUrl, signPayload } from "./webhooks";

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
/** Runs read from the database at a time. */
const BATCH = 100;
/**
 * How long one pass keeps taking batches before it stops for the next tick.
 *
 * One batch a tick used to be the whole pass, which capped a flow at about
 * three thousand people an hour: an import of ten thousand onto a welcome
 * list took three hours to send the first email. Batches now follow each
 * other until nothing is due or this runs out, and the hourly ceiling is
 * still what decides how much actually leaves.
 */
const PASS_MS = 20_000;

/**
 * Nodes one run may pass through in a single tick.
 *
 * Conditions and field writes take no time, so a run walks through them
 * immediately rather than waiting thirty seconds per box. The cap is what
 * stops a flow that somehow points back at itself from spinning forever —
 * the editor cannot build one, but a half-applied edit in principle could.
 */
const HOPS = 20;

/**
 * How long to wait before trying a failed email or call again.
 *
 * Almost everything that fails is temporary — SES throttling, a domain part
 * way through verifying, a receiver that is down for a deploy — so it is
 * tried again rather than dropped. But not forever: after the last of these
 * the run stops, with the error as the reason, instead of retrying a broken
 * address every hour for the rest of time.
 */
const RETRY_MS = [15 * 60_000, 60 * 60_000, 4 * 60 * 60_000, 12 * 60 * 60_000];

/** Longest a webhook box waits for an answer. */
const WEBHOOK_TIMEOUT_MS = 10_000;

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
    if (!job.entryNodeId) continue;

    /*
     * A narrowing is asked here, at the moment somebody would be enrolled,
     * rather than kept as a membership somewhere. A flow for "people on the
     * pro plan" is then right on the day it runs.
     */
    const narrowing =
      job.segmentId && job.listId
        ? await db.query.segment.findFirst({ where: eq(segment.id, job.segmentId) })
        : null;

    const found = await db
      .select({ id: listMember.id, address: listMember.address })
      .from(listMember)
      .where(
        and(
          /*
           * No list means any list: whoever joins any list in the account.
           * The row they joined with is the one the run follows, so the
           * unsubscribe link and the merge fields are that list's.
           */
          job.listId
            ? eq(listMember.listId, job.listId)
            : eq(listMember.organizationId, job.organizationId),
          eq(listMember.status, "subscribed"),
          narrowing ? segmentCondition(narrowing) : undefined,
          /*
           * The date goes in as text and is cast, not handed over as a Date:
           * inside a raw fragment there is no column to tell the driver what
           * type it should be, and postgres-js refuses it outright.
           */
          sql`coalesce(${listMember.consentAt}, ${listMember.createdAt}) >= ${job.createdAt.toISOString()}::timestamptz`,
          job.listId
            ? sql`not exists (
                select 1 from automation_run
                where automation_run.automation_id = ${job.id}
                  and automation_run.list_member_id = ${listMember.id}
              )`
            : /*
               * Once per person, not once per list. Somebody who joins three
               * lists is one person, and a welcome series sent three times
               * is the thing this must never do.
               */
              sql`not exists (
                select 1 from automation_run
                join list_member as enrolled on enrolled.id = automation_run.list_member_id
                where automation_run.automation_id = ${job.id}
                  and enrolled.address = ${listMember.address}
              )`,
        ),
      )
      .orderBy(asc(listMember.createdAt))
      .limit(500);

    // Two lists joined in the same breath are still one person.
    const seen = new Set<string>();
    const fresh = found.filter((person) => {
      if (seen.has(person.address)) return false;
      seen.add(person.address);
      return true;
    });
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

/**
 * What one pass has already read, so a batch of a hundred people in the same
 * flow reads that flow once rather than a hundred times.
 *
 * Made fresh per pass: an edit on the canvas must reach the next pass, and a
 * cache that outlived one would be a second copy of the flow to keep right.
 */
class PassMemory {
  private nodes = new Map<string, Promise<Map<string, AutomationNode>>>();
  private segments = new Map<string, Promise<Segment | null>>();
  private postal = new Map<string, Promise<string | null>>();
  private budgets = new Map<string, number>();
  private openings = new Map<string, Date>();

  flow(automationId: string) {
    let found = this.nodes.get(automationId);
    if (!found) {
      found = db
        .select()
        .from(automationNode)
        .where(eq(automationNode.automationId, automationId))
        .then((rows) => new Map(rows.map((row) => [row.id, row])));
      this.nodes.set(automationId, found);
    }
    return found;
  }

  segment(id: string) {
    let found = this.segments.get(id);
    if (!found) {
      found = db.query.segment.findFirst({ where: eq(segment.id, id) }).then((row) => row ?? null);
      this.segments.set(id, found);
    }
    return found;
  }

  postalAddress(orgId: string) {
    let found = this.postal.get(orgId);
    if (!found) {
      found = db
        .select({ postalAddress: workspace.postalAddress })
        .from(workspace)
        .where(eq(workspace.organizationId, orgId))
        .limit(1)
        .then(([row]) => row?.postalAddress ?? null);
      this.postal.set(orgId, found);
    }
    return found;
  }

  /**
   * What is left of the hourly ceiling, counted down as this pass sends.
   *
   * Asked of the database once per account per pass rather than before every
   * email: the count is a scan of the last hour's sends, and a pass of a
   * thousand emails asking it a thousand times was most of the pass.
   */
  async remaining(orgId: string) {
    if (!this.budgets.has(orgId)) {
      this.budgets.set(orgId, (await sendBudget(orgId)).remaining);
    }
    return this.budgets.get(orgId) ?? 0;
  }

  spend(orgId: string) {
    this.budgets.set(orgId, (this.budgets.get(orgId) ?? 1) - 1);
  }

  /** When this flow's window next opens; now, if it is open. */
  opening(automationId: string, window: SendWindow | null) {
    let found = this.openings.get(automationId);
    if (!found) {
      found = nextOpening(window, new Date());
      this.openings.set(automationId, found);
    }
    return found;
  }
}

interface Person {
  id: string;
  address: string;
  fields: Record<string, string>;
  tags: string[];
}

/**
 * Whether a condition node's answer is yes for this person.
 *
 * `opened` answers the email questions instead of the database when given,
 * which is how a test run asks "and if they did open it".
 */
async function answer(
  node: AutomationNode,
  automationId: string,
  member: Person,
  memory: PassMemory,
  opened?: boolean,
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
    const narrowing = await memory.segment(node.config.segmentId);
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
    if (opened !== undefined) return opened;
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

/** What a split decided, by chance. Its own function so a test can lean on it. */
function takesFirstWay(node: AutomationNode) {
  return Math.random() * 100 < splitShare(node.config);
}

/**
 * Tells somebody's own server that a person reached this box.
 *
 * Signed the same way the account's webhooks are, with a secret belonging to
 * this automation, so the receiver can tell the call came from here. A reply
 * that is not a 2xx counts as a failure and is tried again like an email.
 */
async function callWebhook(url: string, secret: string | null, payload: Record<string, unknown>) {
  const checked = checkWebhookUrl(url);
  if (!checked.ok) throw new Error(checked.reason);
  if (!secret) throw new Error("This automation has no signing secret");

  const body = JSON.stringify(payload);
  const { header } = signPayload(secret, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(checked.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mailroom-Automations/1",
        "X-Mailroom-Event": "automation.step",
        "X-Mailroom-Signature": header,
      },
      body,
      signal: controller.signal,
      redirect: "manual",
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`The URL answered ${response.status}`);
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The URL did not answer in time");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function dueRuns() {
  return db
    .select({
      runId: automationRun.id,
      automationId: automationRun.automationId,
      memberId: automationRun.listMemberId,
      nodeId: automationRun.nodeId,
      parkedAt: automationRun.parkedAt,
      attempts: automationRun.attempts,
      orgId: automationRun.organizationId,
      automationName: automation.name,
      mailboxId: automation.mailboxId,
      listId: automation.listId,
      exitSegmentId: automation.exitSegmentId,
      sendWindow: automation.sendWindow,
      webhookSecret: automation.webhookSecret,
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
    .orderBy(asc(automationRun.nextAt))
    .limit(BATCH);
}

type Due = Awaited<ReturnType<typeof dueRuns>>[number];

export async function runAutomationsOnce(): Promise<AutomationPass> {
  const pass: AutomationPass = { enrolled: await enrol(), sent: 0, failed: 0 };
  const memory = new PassMemory();
  const started = Date.now();
  /*
   * Every way through a run moves its due date forward or ends it, so a
   * second batch never sees the first one's people again. Kept anyway: if a
   * mistake somewhere ever left one due, the pass must end rather than
   * spend its twenty seconds on the same person.
   */
  const handled = new Set<string>();

  while (Date.now() - started < PASS_MS) {
    const due = (await dueRuns()).filter((job) => !handled.has(job.runId));
    if (due.length === 0) break;

    const members = await db
      .select({
        id: listMember.id,
        address: listMember.address,
        name: listMember.name,
        status: listMember.status,
        fields: listMember.fields,
        tags: listMember.tags,
        listId: listMember.listId,
      })
      .from(listMember)
      .where(
        inArray(
          listMember.id,
          due.map((job) => job.memberId),
        ),
      );
    const byId = new Map(members.map((member) => [member.id, member]));

    for (const job of due) {
      handled.add(job.runId);
      await advance(job, byId.get(job.memberId), memory, pass);
    }
  }

  return pass;
}

/** Where a run stops for now, and until when. */
interface Hold {
  nodeId: string;
  until: Date;
  /** Sitting on a wait, rather than due to try this box again. */
  parked: boolean;
  attempts?: number;
  reason?: string;
}

/** Walks one person as far as they can go right now. */
async function advance(
  job: Due,
  member:
    | {
        id: string;
        address: string;
        name: string | null;
        status: string;
        fields: Record<string, string>;
        tags: string[];
        /** The list this run follows: the flow's own, or the one they joined. */
        listId: string;
      }
    | undefined,
  memory: PassMemory,
  pass: AutomationPass,
) {
  /*
   * Somebody who left mid-flow is out of it, not skipped to the next box.
   * The run is kept rather than deleted so the record of how far they got
   * survives, and so re-subscribing does not silently restart them.
   */
  if (!member || member.status !== "subscribed") {
    await db
      .update(automationRun)
      .set({ status: "stopped", stoppedReason: "Left the list", parkedAt: null })
      .where(eq(automationRun.id, job.runId));
    return;
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
    const goal = await memory.segment(job.exitSegmentId);
    if (goal) {
      const [reached] = await db
        .select({ id: listMember.id })
        .from(listMember)
        .where(and(eq(listMember.id, member.id), segmentCondition(goal)))
        .limit(1);

      if (reached) {
        await db
          .update(automationRun)
          .set({ status: "stopped", stoppedReason: `Matched "${goal.name}"`, parkedAt: null })
          .where(eq(automationRun.id, job.runId));
        return;
      }
    }
  }

  const nodes = await memory.flow(job.automationId);
  const now = new Date();

  let at: string | null = job.nodeId;
  let fields = member.fields;
  let tags = member.tags;
  let sent = false;

  /** Where the run stops for now, and until when. */
  let hold: Hold | null = null;
  /** Set when it is over for good, with the reason. */
  let stopped: string | null = null;

  /*
   * Waking up on a box they were sitting on means the wait is over. For a
   * wait for an event, it means the event never came: an arriving one moves
   * them on the moment it lands, so still being here is the answer.
   */
  if (at && job.parkedAt) {
    const here = nodes.get(at);
    at = here ? (here.kind === "await" ? here.nextElse : here.next) : null;
  }

  /** A failed email or call: tried again later, or given up on. */
  const failed = (node: AutomationNode, error: unknown) => {
    const message = error instanceof Error ? error.message : "Could not be done";
    // Failures count against the box they happened on, not the run.
    const tries = (node.id === job.nodeId ? job.attempts : 0) + 1;
    pass.failed += 1;
    if (tries > RETRY_MS.length) {
      stopped = `Gave up after ${tries} tries: ${message}`;
      return;
    }
    hold = {
      nodeId: node.id,
      until: new Date(now.getTime() + (RETRY_MS[tries - 1] ?? 3_600_000)),
      parked: false,
      attempts: tries,
      reason: message,
    };
  };

  for (let hop = 0; hop < HOPS && at && !hold && !stopped; hop += 1) {
    const node: AutomationNode | undefined = nodes.get(at);
    if (!node) {
      at = null;
      break;
    }

    if (node.kind === "wait") {
      // A pause with nothing after it has nothing to come back for.
      if (!node.next) {
        at = null;
        break;
      }

      if (node.waitUntil) {
        /*
         * A moment rather than a length of time, so everybody waiting here
         * moves on together whenever they arrived.
         *
         * Somebody who reaches it after the moment has passed walks
         * straight through. Holding them until the same date next year is
         * the only alternative, and nobody means that.
         */
        if (node.waitUntil.getTime() <= now.getTime()) {
          at = node.next;
          continue;
        }
        hold = { nodeId: node.id, until: node.waitUntil, parked: true };
        break;
      }

      if (node.delayMinutes <= 0) {
        at = node.next;
        continue;
      }

      /*
       * Parked on the wait itself rather than on the box after it, so the
       * canvas can say how many people are sitting on each wait — and so
       * changing its length can reach the people already on it.
       */
      hold = {
        nodeId: node.id,
        until: new Date(now.getTime() + node.delayMinutes * 60_000),
        parked: true,
      };
      break;
    }

    if (node.kind === "await") {
      // The event moves them on when it lands. This is only the deadline.
      hold = {
        nodeId: node.id,
        until: new Date(now.getTime() + Math.max(1, node.delayMinutes) * 60_000),
        parked: true,
      };
      break;
    }

    if (node.kind === "condition") {
      at = (await answer(node, job.automationId, { ...member, fields, tags }, memory))
        ? node.next
        : node.nextElse;
      continue;
    }

    if (node.kind === "split") {
      at = takesFirstWay(node) ? node.next : node.nextElse;
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

      if (target && target !== member.listId) {
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

    if (node.kind === "webhook") {
      try {
        await callWebhook(node.config.url ?? "", job.webhookSecret, {
          event: "automation.step",
          automation: { id: job.automationId, name: job.automationName },
          step: node.id,
          person: { email: member.address, name: member.name, fields, tags },
          at: now.toISOString(),
        });
        at = node.next;
      } catch (error) {
        failed(node, error);
      }
      continue;
    }

    // An email. Anything below here sends.

    /*
     * Outside the hours it may send in, it waits for them to open. Only
     * email is held: a condition or a tag at three in the morning reaches
     * nobody's inbox.
     */
    const opening = memory.opening(job.automationId, job.sendWindow);
    if (opening.getTime() > now.getTime()) {
      hold = { nodeId: node.id, until: opening, parked: false };
      break;
    }

    /*
     * The hourly ceiling, if this instance set one.
     *
     * Asked here rather than at the top of the pass because only this
     * branch sends: a run sitting on a wait or walking a condition costs
     * nothing and must not be held up by a campaign using the allowance.
     * Reaching it leaves the run on this box, due again next tick.
     */
    if ((await memory.remaining(job.orgId)) <= 0) {
      hold = { nodeId: node.id, until: new Date(now.getTime() + TICK_MS), parked: false };
      break;
    }

    /*
     * Cannot happen — switching one on refuses without an address — but the
     * column allows null so a flow can be drawn before anybody has made a
     * mailbox. Left where it is, and asked again in an hour.
     */
    if (!job.mailboxId) {
      hold = {
        nodeId: node.id,
        until: new Date(now.getTime() + 3_600_000),
        parked: false,
        reason: "No address to send from",
      };
      break;
    }

    const url = unsubscribeUrl(member.id);
    const postalAddress = await memory.postalAddress(job.orgId);
    /*
     * The fields as they are now, not as the row was read.
     *
     * A Set a field box earlier in this same pass has already changed them,
     * and an email that greets somebody by the plan they were on before the
     * flow upgraded them is the sort of thing they notice.
     */
    const person = {
      address: member.address,
      name: member.name,
      // No view_in_browser: an automation's email has no web copy, and a
      // placeholder for one would resolve to nothing on purpose.
      fields: { ...fields, preferences: preferencesUrl(member.id) },
    };
    try {
      const subject = merge(node.subject ?? "", person);
      const delivered = await deliverMessage({
        orgId: job.orgId,
        mailboxId: job.mailboxId,
        to: [{ address: member.address, name: member.name }],
        subject,
        html: node.html
          ? withFooter(merge(node.html, person, true), { unsubscribeUrl: url, postalAddress }, true)
          : null,
        text: node.text
          ? withFooter(merge(node.text, person), { unsubscribeUrl: url, postalAddress }, false)
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
        messageId: delivered.messageId,
        address: member.address,
        subject,
      });

      memory.spend(job.orgId);
      pass.sent += 1;
      sent = true;
      at = node.next;
    } catch (error) {
      failed(node, error);
    }
  }

  // Only write the run once, whatever route it took through the flow.
  const lastSent = sent ? { lastSentAt: now } : {};
  // Both can be set from inside `failed`, which the compiler cannot follow.
  const finalHold = hold as Hold | null;
  const finalStop = stopped as string | null;
  if (finalStop) {
    await db
      .update(automationRun)
      .set({ status: "stopped", stoppedReason: finalStop, parkedAt: null, ...lastSent })
      .where(eq(automationRun.id, job.runId));
  } else if (finalHold) {
    await db
      .update(automationRun)
      .set({
        nodeId: finalHold.nodeId,
        nextAt: finalHold.until,
        parkedAt: finalHold.parked ? now : null,
        attempts: finalHold.attempts ?? 0,
        stoppedReason: finalHold.reason ?? null,
        ...lastSent,
      })
      .where(eq(automationRun.id, job.runId));
  } else if (!at) {
    await db
      .update(automationRun)
      .set({
        status: "done",
        nodeId: null,
        parkedAt: null,
        attempts: 0,
        stoppedReason: null,
        ...lastSent,
      })
      .where(eq(automationRun.id, job.runId));
  } else {
    // Ran out of hops. Picked up again next tick rather than abandoned.
    await db
      .update(automationRun)
      .set({
        nodeId: at,
        nextAt: new Date(now.getTime() + TICK_MS),
        parkedAt: null,
        attempts: 0,
        ...lastSent,
      })
      .where(eq(automationRun.id, job.runId));
  }
}

/* -------------------------------------------------------------------------- */
/* A test run                                                                 */
/* -------------------------------------------------------------------------- */

export interface SimulatedStep {
  nodeId: string;
  text: string;
}

export interface Simulation {
  steps: SimulatedStep[];
  /** How it ends, in words. */
  end: string;
  /** Anything about the person that shaped the answer. */
  note?: string;
}

/**
 * Walks one person through a flow without doing anything to them.
 *
 * Nothing is sent, written or called: the point is to see which way they
 * would go before a real person does. Real answers where there are real
 * ones — their fields, tags, segments and lists — and the reader's choice
 * where the answer is something that has not happened yet, like whether
 * they will open an email.
 */
export async function simulateRun(
  orgId: string,
  automationId: string,
  input: { address: string; opens: boolean; eventArrives: boolean; splitTo: "a" | "b" },
): Promise<Simulation> {
  const row = await db.query.automation.findFirst({
    where: and(eq(automation.id, automationId), eq(automation.organizationId, orgId)),
  });
  if (!row) throw new Error("No such automation");

  const address = input.address.trim().toLowerCase();
  // With no list, whichever list they joined most recently.
  const found = await db.query.listMember.findFirst({
    where: and(
      row.listId ? eq(listMember.listId, row.listId) : eq(listMember.organizationId, orgId),
      eq(listMember.address, address),
    ),
    orderBy: desc(listMember.createdAt),
    columns: { id: true, address: true, fields: true, tags: true, status: true },
  });

  const memory = new PassMemory();
  const person: Person = found
    ? { id: found.id, address: found.address, fields: { ...found.fields }, tags: [...found.tags] }
    : { id: "", address, fields: {}, tags: [] };

  const notes: string[] = [];
  if (!found) {
    notes.push(
      `Not on ${row.listId ? "the list" : "any list"}, so treated as somebody new with no fields or tags.`,
    );
  } else if (found.status !== "subscribed")
    notes.push(`They are ${found.status}, so a real run would not start.`);

  if (found && row.segmentId) {
    const narrowing = await memory.segment(row.segmentId);
    if (narrowing) {
      const [match] = await db
        .select({ id: listMember.id })
        .from(listMember)
        .where(and(eq(listMember.id, found.id), segmentCondition(narrowing)))
        .limit(1);
      if (!match) notes.push(`Not in "${narrowing.name}", so a real run would not start.`);
    }
  }

  const nodes = await memory.flow(automationId);
  const lists = new Map<string, string>();
  const steps: SimulatedStep[] = [];
  let sentBefore = false;
  let at = row.entryNodeId;
  let end = "They reach the end of the flow.";
  const seen = new Set<string>();

  while (at && !seen.has(at)) {
    seen.add(at);
    const node = nodes.get(at);
    if (!node) break;
    const step = (text: string) => steps.push({ nodeId: node.id, text });

    if (node.kind === "email") {
      step(`Sent "${merge(node.subject ?? "", { address, name: null, fields: person.fields })}"`);
      sentBefore = true;
      at = node.next;
    } else if (node.kind === "wait") {
      if (!node.next) {
        step("Nothing after the wait, so it ends here");
        break;
      }
      if (node.waitUntil) {
        step(
          node.waitUntil.getTime() > Date.now()
            ? `Waits until ${onThe(node.waitUntil)}`
            : "The date has passed, so straight on",
        );
      } else {
        step(node.delayMinutes > 0 ? `Waits ${humanDelay(node.delayMinutes)}` : "No pause");
      }
      at = node.next;
    } else if (node.kind === "await") {
      const event = node.config.event || "the event";
      if (input.eventArrives) {
        step(`${event} arrives`);
        at = node.next;
      } else {
        step(`Waits ${humanDelay(Math.max(1, node.delayMinutes))}; ${event} never comes`);
        at = node.nextElse;
      }
    } else if (node.kind === "condition") {
      const test = node.config.test ?? "opened";
      const email = test === "opened" || test === "clicked";
      const yes = await answer(
        node,
        automationId,
        person,
        memory,
        email ? sentBefore && input.opens : undefined,
      );
      step(`${describeTest(node.config)} ${yes ? "Yes" : "No"}`);
      at = yes ? node.next : node.nextElse;
    } else if (node.kind === "split") {
      const share = splitShare(node.config);
      const first = input.splitTo === "a";
      step(`Split: goes ${first ? `A (${share}%)` : `B (${100 - share}%)`}`);
      at = first ? node.next : node.nextElse;
    } else if (node.kind === "field") {
      const key = node.config.field?.trim();
      if (key) person.fields[key] = node.config.value ?? "";
      step(key ? `${key} set to "${node.config.value ?? ""}"` : "No field picked, so nothing");
      at = node.next;
    } else if (node.kind === "tag") {
      const tag = node.config.tag?.trim();
      if (tag) {
        person.tags =
          node.config.tagAction === "remove"
            ? person.tags.filter((entry) => entry !== tag)
            : [...new Set([...person.tags, tag])];
      }
      step(
        !tag
          ? "No tag picked, so nothing"
          : node.config.tagAction === "remove"
            ? `Tag "${tag}" taken off`
            : `Tagged "${tag}"`,
      );
      at = node.next;
    } else if (node.kind === "move") {
      const target = node.config.listId ?? "";
      if (target && !lists.has(target)) {
        const list = await db.query.mailingList.findFirst({
          where: (table, { eq: equals }) => equals(table.id, target),
          columns: { name: true },
        });
        lists.set(target, list?.name ?? "another list");
      }
      const where = lists.get(target) ?? "another list";
      if (node.config.listAction === "move") {
        step(`Moved to ${where}`);
        end = "They leave this list, and so this flow.";
        break;
      }
      step(`Copied to ${where}`);
      at = node.next;
    } else if (node.kind === "unsubscribe") {
      step("Taken off the list");
      end = "They are unsubscribed, and the flow ends.";
      break;
    } else if (node.kind === "webhook") {
      step(`Calls ${node.config.url || "a URL nobody has set"}`);
      at = node.next;
    }
  }

  if (at && seen.has(at)) end = "The flow loops back on itself here.";
  return { steps, end, note: notes.join(" ") || undefined };
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
