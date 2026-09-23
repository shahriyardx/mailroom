import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * Events posted by somebody's own code, and the flows waiting for them.
 *
 * What is load-bearing here is consent and repetition. An event carrying an
 * address is not that person asking for mail, so an address nobody has heard
 * of is skipped rather than quietly subscribed. And an event is a thing that
 * happens more than once — an order ships every week — so a finished run has
 * to start again while a running one must not be started twice.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("custom_events");
  account = await seedAccount();
  process.env.BETTER_AUTH_SECRET ??= "test-secret-for-event-tests";
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const {
    automation,
    automationNode,
    automationRun,
    customEvent,
    listMember,
    mailingList,
    segment,
  } = await import("@/db/schema");
  await db.delete(automationRun);
  await db.update(automation).set({ entryNodeId: null });
  await db.delete(automationNode);
  await db.delete(automation);
  await db.delete(listMember);
  await db.delete(segment);
  await db.delete(mailingList);
  await db.delete(customEvent);
});

/** A live automation waiting for one event, with a wait box so nothing sends. */
async function waitingFor(event: string) {
  const { createList } = await import("@/server/campaigns");
  const { addNode, createAutomation, updateAutomation } = await import("@/server/automations");

  const listId = await createList(account.orgId, "Customers");
  const id = await createAutomation(account.orgId, {
    mailboxId: account.mailboxId,
    name: "After the trial",
  });
  await addNode(account.orgId, id, { kind: "wait" });
  await updateAutomation(account.orgId, id, { trigger: "event", listId, eventName: event });
  await updateAutomation(account.orgId, id, { status: "active" });
  return { id, listId };
}

async function runsFor(automationId: string) {
  const { db } = await import("@/db");
  const { automationRun } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  return db.select().from(automationRun).where(eq(automationRun.automationId, automationId));
}

describe("event names", () => {
  it("are the same name however they were typed", async () => {
    const { normaliseEventName } = await import("@/server/custom-events");
    assert.equal(normaliseEventName("  Trial.Ended "), "trial.ended");
    assert.equal(normaliseEventName("order shipped"), "order_shipped");
    assert.equal(normaliseEventName("...card.declined..."), "card.declined");
  });
});

describe("posting an event", () => {
  it("starts the flow waiting for it", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { emitEvent } = await import("@/server/custom-events");
    const { id, listId } = await waitingFor("trial.ended");
    await addMembers(account.orgId, listId, [{ address: "pat@example.com" }], "import");

    const receipt = await emitEvent(account.orgId, {
      name: "trial.ended",
      address: "pat@example.com",
    });

    assert.equal(receipt.matched.length, 1);
    assert.equal(receipt.matched[0]?.status, "started");
    assert.equal((await runsFor(id)).length, 1);
  });

  it("matches however the name was cased", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { emitEvent } = await import("@/server/custom-events");
    const { id, listId } = await waitingFor("trial.ended");
    await addMembers(account.orgId, listId, [{ address: "pat@example.com" }], "import");

    await emitEvent(account.orgId, { name: "Trial.Ended", address: "PAT@example.com" });
    assert.equal((await runsFor(id)).length, 1);
  });

  it("leaves a stranger alone unless consent came with them", async () => {
    const { emitEvent } = await import("@/server/custom-events");
    const { id } = await waitingFor("trial.ended");

    const receipt = await emitEvent(account.orgId, {
      name: "trial.ended",
      address: "stranger@example.com",
    });

    assert.equal(receipt.matched[0]?.status, "skipped");
    assert.match(receipt.matched[0]?.reason ?? "", /Not on/);
    assert.equal((await runsFor(id)).length, 0);
  });

  it("adds them when the call says where consent came from", async () => {
    const { emitEvent } = await import("@/server/custom-events");
    const { id } = await waitingFor("trial.ended");

    const receipt = await emitEvent(account.orgId, {
      name: "trial.ended",
      address: "stranger@example.com",
      consentSource: "signed up at checkout",
    });

    assert.equal(receipt.matched[0]?.status, "started");
    assert.equal((await runsFor(id)).length, 1);
  });

  it("writes what came with it onto the person", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { emitEvent } = await import("@/server/custom-events");
    const { listId } = await waitingFor("order.shipped");
    await addMembers(
      account.orgId,
      listId,
      [{ address: "pat@example.com", fields: { plan: "pro" } }],
      "import",
    );

    await emitEvent(account.orgId, {
      name: "order.shipped",
      address: "pat@example.com",
      fields: { order: "A-19" },
    });

    const { db } = await import("@/db");
    const { listMember } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select()
      .from(listMember)
      .where(eq(listMember.address, "pat@example.com"));

    // Merged, not replaced: an event about one thing must not wipe the rest.
    assert.equal(row?.fields.order, "A-19");
    assert.equal(row?.fields.plan, "pro");
  });

  it("does not start a second copy while one is running", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { emitEvent } = await import("@/server/custom-events");
    const { id, listId } = await waitingFor("order.shipped");
    await addMembers(account.orgId, listId, [{ address: "pat@example.com" }], "import");

    await emitEvent(account.orgId, { name: "order.shipped", address: "pat@example.com" });
    const again = await emitEvent(account.orgId, {
      name: "order.shipped",
      address: "pat@example.com",
    });

    assert.equal(again.matched[0]?.status, "already_running");
    assert.equal((await runsFor(id)).length, 1);
  });

  it("starts somebody again once they have finished", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { emitEvent } = await import("@/server/custom-events");
    const { db } = await import("@/db");
    const { automationRun } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { id, listId } = await waitingFor("order.shipped");
    await addMembers(account.orgId, listId, [{ address: "pat@example.com" }], "import");
    await emitEvent(account.orgId, { name: "order.shipped", address: "pat@example.com" });
    await db.update(automationRun).set({ status: "done", nodeId: null });

    const again = await emitEvent(account.orgId, {
      name: "order.shipped",
      address: "pat@example.com",
    });

    assert.equal(again.matched[0]?.status, "restarted");
    const rows = await db.select().from(automationRun).where(eq(automationRun.automationId, id));
    // The same row, sent back to the top, rather than a second one beside it.
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, "active");
  });

  it("leaves somebody who unsubscribed out of it", async () => {
    const { addMembers, setMemberStatus } = await import("@/server/campaigns");
    const { emitEvent } = await import("@/server/custom-events");
    const { db } = await import("@/db");
    const { listMember } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { id, listId } = await waitingFor("trial.ended");
    await addMembers(account.orgId, listId, [{ address: "pat@example.com" }], "import");
    const [row] = await db
      .select()
      .from(listMember)
      .where(eq(listMember.address, "pat@example.com"));
    await setMemberStatus(account.orgId, row?.id ?? "", "unsubscribed");

    const receipt = await emitEvent(account.orgId, {
      name: "trial.ended",
      address: "pat@example.com",
    });

    assert.equal(receipt.matched[0]?.status, "skipped");
    assert.equal((await runsFor(id)).length, 0);
  });

  it("records a name nobody declared, so a typo can be seen", async () => {
    const { emitEvent, eventsView } = await import("@/server/custom-events");

    await emitEvent(account.orgId, { name: "trail.ended", address: "pat@example.com" });

    const rows = await eventsView(account.orgId);
    const found = rows.find((row) => row.name === "trail.ended");
    assert.equal(found?.declared, false);
    assert.equal(found?.seenCount, 1);
  });

  it("counts every arrival under a declared name", async () => {
    const { createEvent, emitEvent, eventsView } = await import("@/server/custom-events");
    await createEvent(account.orgId, { name: "trial.ended", description: "The trial ran out" });

    await emitEvent(account.orgId, { name: "trial.ended", address: "a@example.com" });
    await emitEvent(account.orgId, { name: "trial.ended", address: "b@example.com" });

    const found = (await eventsView(account.orgId)).find((row) => row.name === "trial.ended");
    assert.equal(found?.declared, true);
    assert.equal(found?.seenCount, 2);
  });

  it("does nothing for a paused automation", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { updateAutomation } = await import("@/server/automations");
    const { emitEvent } = await import("@/server/custom-events");

    const { id, listId } = await waitingFor("trial.ended");
    await addMembers(account.orgId, listId, [{ address: "pat@example.com" }], "import");
    await updateAutomation(account.orgId, id, { status: "paused" });

    const receipt = await emitEvent(account.orgId, {
      name: "trial.ended",
      address: "pat@example.com",
    });

    assert.equal(receipt.matched.length, 0);
    assert.equal((await runsFor(id)).length, 0);
  });
});

describe("narrowing a flow to a segment", () => {
  /** The same live event flow, aimed only at people whose plan is pro. */
  async function narrowed() {
    const { createSegment } = await import("@/server/segments");
    const { updateAutomation } = await import("@/server/automations");
    const { id, listId } = await waitingFor("trial.ended");
    const segmentId = await createSegment(account.orgId, {
      listId,
      name: "On the pro plan",
      rules: [{ field: "fields.plan", op: "is", value: "pro" }],
    });
    await updateAutomation(account.orgId, id, { segmentId });
    return { id, listId, segmentId };
  }

  it("skips somebody the segment does not match, and says so", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { emitEvent } = await import("@/server/custom-events");
    const { id, listId } = await narrowed();
    await addMembers(
      account.orgId,
      listId,
      [{ address: "free@example.com", fields: { plan: "free" } }],
      "import",
    );

    const receipt = await emitEvent(account.orgId, {
      name: "trial.ended",
      address: "free@example.com",
    });

    assert.equal(receipt.matched[0]?.status, "skipped");
    assert.match(receipt.matched[0]?.reason ?? "", /On the pro plan/);
    assert.equal((await runsFor(id)).length, 0);
  });

  it("starts the flow for somebody it does match", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { emitEvent } = await import("@/server/custom-events");
    const { id, listId } = await narrowed();
    await addMembers(
      account.orgId,
      listId,
      [{ address: "paid@example.com", fields: { plan: "pro" } }],
      "import",
    );

    const receipt = await emitEvent(account.orgId, {
      name: "trial.ended",
      address: "paid@example.com",
    });

    assert.equal(receipt.matched[0]?.status, "started");
    assert.equal((await runsFor(id)).length, 1);
  });

  it("counts a field the same event just set", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { emitEvent } = await import("@/server/custom-events");
    const { id, listId } = await narrowed();
    await addMembers(account.orgId, listId, [{ address: "new@example.com" }], "import");

    const receipt = await emitEvent(account.orgId, {
      name: "trial.ended",
      address: "new@example.com",
      fields: { plan: "pro" },
    });

    // The fields arrive with the event, so the segment has to be asked after
    // they are written or the call can never match its own flow.
    assert.equal(receipt.matched[0]?.status, "started");
    assert.equal((await runsFor(id)).length, 1);
  });

  it("narrows who is swept into a joining flow too", async () => {
    const { addMembers, createList } = await import("@/server/campaigns");
    const { addNode, createAutomation, updateAutomation } = await import("@/server/automations");
    const { createSegment } = await import("@/server/segments");
    const { runAutomationsOnce } = await import("@/server/automation-runner");

    const listId = await createList(account.orgId, "Newsletter");
    const segmentId = await createSegment(account.orgId, {
      listId,
      name: "On the pro plan",
      rules: [{ field: "fields.plan", op: "is", value: "pro" }],
    });
    const id = await createAutomation(account.orgId, {
      mailboxId: account.mailboxId,
      name: "Only for the paying ones",
    });
    await addNode(account.orgId, id, { kind: "wait" });
    await updateAutomation(account.orgId, id, { trigger: "subscribed", listId, segmentId });
    await updateAutomation(account.orgId, id, { status: "active" });

    await addMembers(
      account.orgId,
      listId,
      [
        { address: "paid@example.com", fields: { plan: "pro" } },
        { address: "free@example.com", fields: { plan: "free" } },
      ],
      "signup form",
    );

    const pass = await runAutomationsOnce();
    assert.equal(pass.enrolled, 1);
    assert.equal((await runsFor(id)).length, 1);
  });

  it("refuses a segment about a different list", async () => {
    const { createList } = await import("@/server/campaigns");
    const { createSegment } = await import("@/server/segments");
    const { updateAutomation } = await import("@/server/automations");
    const { id } = await waitingFor("trial.ended");

    const other = await createList(account.orgId, "Somewhere else");
    const segmentId = await createSegment(account.orgId, {
      listId: other,
      name: "Elsewhere",
      rules: [],
    });

    await assert.rejects(
      () => updateAutomation(account.orgId, id, { segmentId }),
      /different list/,
    );
  });

  it("drops the narrowing when the list moves out from under it", async () => {
    const { createList } = await import("@/server/campaigns");
    const { updateAutomation, findAutomation } = await import("@/server/automations");
    const { id } = await narrowed();

    const other = await createList(account.orgId, "Somewhere else");
    await updateAutomation(account.orgId, id, { listId: other });

    // Keeping it would leave a flow asking about the wrong list's people and
    // enrolling nobody, with nothing on screen saying why.
    const row = await findAutomation(account.orgId, id);
    assert.equal(row?.segmentId, null);
  });
});

describe("declaring one", () => {
  it("adopts a name that already arrived rather than duplicating it", async () => {
    const { createEvent, emitEvent, eventsView } = await import("@/server/custom-events");

    await emitEvent(account.orgId, { name: "trial.ended", address: "pat@example.com" });
    await createEvent(account.orgId, { name: "Trial.Ended", description: "Written down later" });

    const rows = (await eventsView(account.orgId)).filter((row) => row.name === "trial.ended");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.declared, true);
    assert.equal(rows[0]?.seenCount, 1);
  });
});

describe("what starts a flow", () => {
  it("refuses to switch on before the trigger is answered", async () => {
    const { createAutomation, addNode, updateAutomation } = await import("@/server/automations");
    const id = await createAutomation(account.orgId, {
      mailboxId: account.mailboxId,
      name: "Half built",
    });
    await addNode(account.orgId, id, { kind: "wait" });

    await assert.rejects(
      () => updateAutomation(account.orgId, id, { status: "active" }),
      /Choose what starts/,
    );
  });

  it("refuses an event flow with no event chosen", async () => {
    const { createList } = await import("@/server/campaigns");
    const { createAutomation, addNode, updateAutomation } = await import("@/server/automations");
    const listId = await createList(account.orgId, "Customers");
    const id = await createAutomation(account.orgId, {
      mailboxId: account.mailboxId,
      name: "Half built",
    });
    await addNode(account.orgId, id, { kind: "wait" });
    await updateAutomation(account.orgId, id, { trigger: "event", listId });

    await assert.rejects(
      () => updateAutomation(account.orgId, id, { status: "active" }),
      /which event/,
    );
  });

  it("does not sweep people into an event flow when they join the list", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { runAutomationsOnce } = await import("@/server/automation-runner");
    const { id, listId } = await waitingFor("trial.ended");

    await addMembers(account.orgId, listId, [{ address: "pat@example.com" }], "signup form");
    const pass = await runAutomationsOnce();

    // Joining is not the event. Only the call is.
    assert.equal(pass.enrolled, 0);
    assert.equal((await runsFor(id)).length, 0);
  });
});
