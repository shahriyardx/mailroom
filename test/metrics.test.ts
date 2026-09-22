import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { newId } from "@/lib/utils";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * The numbers on the metrics screen.
 *
 * Everything here is counted in SQL over the message table, which is the part
 * worth testing: a rate is one division away from being wrong in a way that
 * still looks plausible, and an account reading a 0% bounce rate while SES is
 * about to suspend it is worse than having no screen at all.
 */

let scratch: Scratch;
let account: Seeded;

const DAY = 86_400_000;

before(async () => {
  scratch = makeScratchDatabase("metrics");
  account = await seedAccount();
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { message, messageEvent, thread } = await import("@/db/schema");

  await db.delete(messageEvent);
  await db.delete(message);
  await db.delete(thread);
});

function access() {
  return { orgId: account.orgId, isRoot: true, memberId: newId("mem"), teamIds: [] as string[] };
}

/** One outbound message, at a given age in days, in a given state. */
async function sent(options: {
  daysAgo?: number;
  status?: "sent" | "delivered" | "bounced" | "complained";
  opened?: boolean;
  test?: boolean;
  /** SES's bounce type and subtype, or a complaint's feedback type. */
  detail?: string;
  eventType?: "bounce" | "complaint";
}) {
  const { db } = await import("@/db");
  const { message, messageEvent, thread } = await import("@/db/schema");

  const threadId = newId("thr");
  const messageId = newId("msg");
  const at = new Date(Date.now() - (options.daysAgo ?? 0) * DAY);

  await db.insert(thread).values({ id: threadId, mailboxId: account.mailboxId });
  await db.insert(message).values({
    id: messageId,
    threadId,
    mailboxId: account.mailboxId,
    fromAddress: account.address,
    isOutbound: true,
    isDraft: false,
    isTest: options.test ?? false,
    deliveryStatus: options.status ?? "delivered",
    openedAt: options.opened ? at : null,
    sentAt: at,
    createdAt: at,
    receivedAt: at,
  });

  if (options.eventType) {
    await db.insert(messageEvent).values({
      id: newId("evt"),
      messageId,
      type: options.eventType,
      detail: options.detail ?? null,
      occurredAt: at,
    });
  }

  return messageId;
}

describe("what the metrics screen counts", () => {
  it("shows nothing as nothing, rather than as zero per cent", async () => {
    const { metricsView } = await import("@/server/metrics");
    const view = await metricsView(access(), { range: 15 });

    // A rate needs something to be a rate of. Reporting 0% for an account
    // that has sent nothing says its mail is bouncing.
    assert.equal(view.totals.sent, 0);
    assert.equal(view.bounceRate, null);
    assert.equal(view.deliverability, null);
    assert.equal(view.days.length, 15);
  });

  it("gives every day in the range a bucket, including the empty ones", async () => {
    const { metricsView } = await import("@/server/metrics");
    await sent({ daysAgo: 3 });

    const view = await metricsView(access(), { range: 7 });
    assert.equal(view.days.length, 7);
    assert.equal(
      view.days.filter((day) => day.sent > 0).length,
      1,
      "only the day something was sent on carries a count",
    );
  });

  it("counts a complaint as delivered, because it could not exist otherwise", async () => {
    const { metricsView } = await import("@/server/metrics");
    await sent({ status: "delivered" });
    await sent({ status: "complained", eventType: "complaint", detail: "abuse" });

    const view = await metricsView(access(), { range: 7 });
    assert.equal(view.totals.sent, 2);
    // Both arrived. One of them was then reported, which does not un-deliver
    // it — a deliverability rate that falls when somebody presses the spam
    // button is measuring the wrong thing.
    assert.equal(view.deliverability, 100);
    assert.equal(view.complaintRate, 50);
  });

  it("leaves test sends out of every count", async () => {
    const { metricsView } = await import("@/server/metrics");
    await sent({ status: "delivered" });
    await sent({ status: "delivered", test: true });

    const view = await metricsView(access(), { range: 7 });
    assert.equal(view.totals.sent, 1, "a test send never reached SES");
  });

  it("leaves out anything older than the range", async () => {
    const { metricsView } = await import("@/server/metrics");
    await sent({ daysAgo: 1 });
    await sent({ daysAgo: 40 });

    assert.equal((await metricsView(access(), { range: 7 })).totals.sent, 1);
    assert.equal((await metricsView(access(), { range: 90 })).totals.sent, 2);
  });

  it("keeps two decimals, which is where a complaint rate lives", async () => {
    const { metricsView } = await import("@/server/metrics");
    // One complaint in a thousand is 0.1% — exactly Amazon's threshold, and
    // 0% to anything that rounds.
    await sent({ status: "complained", eventType: "complaint" });
    for (let index = 0; index < 999; index++) await sent({ status: "delivered" });

    const view = await metricsView(access(), { range: 7 });
    assert.equal(view.totals.sent, 1000);
    assert.equal(view.complaintRate, 0.1);
  });

  it("splits bounces by the type SES gave them", async () => {
    const { metricsView } = await import("@/server/metrics");
    await sent({ status: "bounced", eventType: "bounce", detail: "Permanent/General" });
    await sent({ status: "bounced", eventType: "bounce", detail: "Permanent/NoEmail" });
    await sent({ status: "bounced", eventType: "bounce", detail: "Transient/MailboxFull" });
    await sent({ status: "delivered" });

    const view = await metricsView(access(), { range: 7 });
    assert.equal(view.bounceRate, 75);

    const permanent = view.bounces.find((row) => row.kind === "Permanent");
    const transient = view.bounces.find((row) => row.kind === "Transient");
    assert.equal(permanent?.howMany, 2, "the subtype is dropped, the type is kept");
    assert.equal(transient?.howMany, 1);
    assert.equal(permanent?.rate, 50);
  });

  it("calls a bounce with no type undetermined rather than blank", async () => {
    const { metricsView } = await import("@/server/metrics");
    await sent({ status: "bounced", eventType: "bounce", detail: null as unknown as undefined });

    const view = await metricsView(access(), { range: 7 });
    assert.deepEqual(
      view.bounces.map((row) => row.kind),
      ["Undetermined"],
    );
  });

  it("reads the open rate against what was delivered, not what was sent", async () => {
    const { metricsView } = await import("@/server/metrics");
    await sent({ status: "delivered", opened: true });
    await sent({ status: "delivered" });
    await sent({ status: "bounced", eventType: "bounce", detail: "Permanent/General" });

    const view = await metricsView(access(), { range: 7 });
    // A message that bounced was never going to be opened, so counting it
    // against the open rate would punish the account twice for one bounce.
    assert.equal(view.totals.delivered, 2);
    assert.equal(view.openRate, 50);
  });

  it("says nothing about another account's mail", async () => {
    const { metricsView } = await import("@/server/metrics");
    await sent({ status: "delivered" });

    const view = await metricsView(
      { orgId: newId("org"), isRoot: true, memberId: newId("mem"), teamIds: [] },
      { range: 7 },
    );
    assert.equal(view.totals.sent, 0);
  });

  it("narrows to one domain, and offers the domains it can see", async () => {
    const { metricsView } = await import("@/server/metrics");
    await sent({ status: "delivered" });

    const view = await metricsView(access(), { range: 7, domainId: account.domainId });
    assert.equal(view.totals.sent, 1);
    assert.deepEqual(
      view.domains.map((entry) => entry.name),
      ["example.test"],
    );

    const elsewhere = await metricsView(access(), { range: 7, domainId: newId("dom") });
    assert.equal(elsewhere.totals.sent, 0);
  });

  it("falls back to a range it offers when asked for one it does not", async () => {
    const { metricsView } = await import("@/server/metrics");

    assert.equal((await metricsView(access(), { range: "9999" })).range, 15);
    assert.equal((await metricsView(access(), { range: "nonsense" })).range, 15);
    assert.equal((await metricsView(access(), { range: "30" })).range, 30);
  });
});
