import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * Flows that run on the subscriber's clock.
 *
 * Three rules here are load-bearing. Removing a box joins the flow back up
 * around it, or everything below is severed and silently never sent. An
 * automation with an empty canvas cannot be switched on, because enrolling
 * somebody into nothing marks them done — and done people are never enrolled
 * again once the flow is written. And a pass walks through the boxes that
 * take no time rather than sleeping on each one.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("automations");
  account = await seedAccount();
  process.env.BETTER_AUTH_SECRET ??= "test-secret-for-automation-tests";
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { automation, automationNode, automationRun, listMember, mailingList } = await import(
    "@/db/schema"
  );
  await db.delete(automationRun);
  await db.update(automation).set({ entryNodeId: null });
  await db.delete(automationNode);
  await db.delete(automation);
  await db.delete(listMember);
  await db.delete(mailingList);
});

async function anAutomation(name = "Welcome") {
  const { createList } = await import("@/server/campaigns");
  const { createAutomation } = await import("@/server/automations");
  const listId = await createList(account.orgId, "Newsletter");
  const id = await createAutomation(account.orgId, {
    listId,
    mailboxId: account.mailboxId,
    name,
  });
  return { id, listId };
}

describe("building a flow", () => {
  it("makes the first box the entry point", async () => {
    const { addNode, findAutomation } = await import("@/server/automations");
    const { id } = await anAutomation();

    const first = await addNode(account.orgId, id, { kind: "email" });
    const row = await findAutomation(account.orgId, id);
    assert.equal(row?.entryNodeId, first);
  });

  it("splices a box into the middle without cutting anything off", async () => {
    const { addNode, findAutomation } = await import("@/server/automations");
    const { id } = await anAutomation();

    const first = await addNode(account.orgId, id, { kind: "email" });
    const second = await addNode(account.orgId, id, { kind: "email", after: first });
    // Onto the same arrow the second one is on: it goes between them.
    const middle = await addNode(account.orgId, id, { kind: "wait", after: first });

    const row = await findAutomation(account.orgId, id);
    const by = new Map(row?.nodes.map((node) => [node.id, node]));
    assert.equal(by.get(first)?.next, middle);
    assert.equal(by.get(middle)?.next, second);
    assert.equal(by.get(second)?.next, null);
  });

  it("puts a new first box in front of the old one", async () => {
    const { addNode, findAutomation } = await import("@/server/automations");
    const { id } = await anAutomation();

    const first = await addNode(account.orgId, id, { kind: "email" });
    const front = await addNode(account.orgId, id, { kind: "wait" });

    const row = await findAutomation(account.orgId, id);
    assert.equal(row?.entryNodeId, front);
    assert.equal(row?.nodes.find((node) => node.id === front)?.next, first);
  });

  it("hangs a branch off the no side of a condition", async () => {
    const { addNode, findAutomation } = await import("@/server/automations");
    const { id } = await anAutomation();

    const test = await addNode(account.orgId, id, { kind: "condition" });
    const yes = await addNode(account.orgId, id, { kind: "email", after: test });
    const no = await addNode(account.orgId, id, {
      kind: "email",
      after: test,
      branch: "nextElse",
    });

    const row = await findAutomation(account.orgId, id);
    const node = row?.nodes.find((entry) => entry.id === test);
    assert.equal(node?.next, yes);
    assert.equal(node?.nextElse, no);
  });

  it("joins the flow back up when a box is removed", async () => {
    const { addNode, findAutomation, removeNode } = await import("@/server/automations");
    const { id } = await anAutomation();

    const first = await addNode(account.orgId, id, { kind: "email" });
    const middle = await addNode(account.orgId, id, { kind: "wait", after: first });
    const last = await addNode(account.orgId, id, { kind: "email", after: middle });

    await removeNode(account.orgId, middle);

    const row = await findAutomation(account.orgId, id);
    // Otherwise everything below the hole is severed and never sent.
    assert.equal(row?.nodes.find((node) => node.id === first)?.next, last);
    assert.equal(row?.nodes.length, 2);
  });

  it("moves the entry point on when the first box goes", async () => {
    const { addNode, findAutomation, removeNode } = await import("@/server/automations");
    const { id } = await anAutomation();

    const first = await addNode(account.orgId, id, { kind: "email" });
    const second = await addNode(account.orgId, id, { kind: "email", after: first });
    await removeNode(account.orgId, first);

    const row = await findAutomation(account.orgId, id);
    assert.equal(row?.entryNodeId, second);
  });

  it("takes the no branch with a deleted condition", async () => {
    const { addNode, findAutomation, removeNode } = await import("@/server/automations");
    const { id } = await anAutomation();

    const test = await addNode(account.orgId, id, { kind: "condition" });
    const yes = await addNode(account.orgId, id, { kind: "email", after: test });
    await addNode(account.orgId, id, { kind: "email", after: test, branch: "nextElse" });

    // The no branch has nowhere to hang from once the condition is gone, so
    // it goes with it — and the dialog that offers this says so.
    await removeNode(account.orgId, test);

    const row = await findAutomation(account.orgId, id);
    assert.deepEqual(
      row?.nodes.map((node) => node.id),
      [yes],
    );
    assert.equal(row?.entryNodeId, yes);
  });

  it("will not let a negative wait through", async () => {
    const { addNode, findAutomation, updateNode } = await import("@/server/automations");
    const { id } = await anAutomation();
    const node = await addNode(account.orgId, id, { kind: "wait" });

    await updateNode(account.orgId, node, { delayMinutes: -60 });
    const row = await findAutomation(account.orgId, id);
    assert.equal(row?.nodes[0]?.delayMinutes, 0);
  });

  it("compiles a design into the body, like everything else here", async () => {
    const { emptyDesign, newBlock } = await import("@/lib/email-blocks");
    const { addNode, findAutomation, updateNode } = await import("@/server/automations");
    const { id } = await anAutomation();
    const node = await addNode(account.orgId, id, { kind: "email" });

    await updateNode(account.orgId, node, {
      design: {
        ...emptyDesign(),
        blocks: [{ ...newBlock("heading", "b1"), text: "Welcome" }],
      } as never,
    });

    const row = await findAutomation(account.orgId, id);
    assert.ok(row?.nodes[0]?.html?.includes("Welcome"));
    assert.equal(row?.nodes[0]?.text, "Welcome");
  });
});

describe("switching one on", () => {
  it("refuses while the canvas is empty", async () => {
    const { updateAutomation } = await import("@/server/automations");
    const { id } = await anAutomation();

    // Otherwise everybody who joins is enrolled into nothing and marked done,
    // which quietly means they can never be enrolled once it is written.
    await assert.rejects(() => updateAutomation(account.orgId, id, { status: "active" }));
  });

  it("allows it once there is something on the canvas", async () => {
    const { addNode, automationsView, updateAutomation } = await import("@/server/automations");
    const { id } = await anAutomation();
    await addNode(account.orgId, id, { kind: "email" });

    await updateAutomation(account.orgId, id, { status: "active" });
    const [row] = await automationsView(account.orgId);
    assert.equal(row?.status, "active");
    assert.equal(row?.steps, 1);
  });
});

describe("who gets put through it", () => {
  it("enrols somebody who joins after it was made, and nobody who was already there", async () => {
    const { addMembers, createList } = await import("@/server/campaigns");
    const { addNode, createAutomation, updateAutomation } = await import("@/server/automations");
    const { db } = await import("@/db");
    const { automationRun, listMember } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const listId = await createList(account.orgId, "Newsletter");

    // On the list well before the automation existed.
    await addMembers(account.orgId, listId, [{ address: "old@example.com" }], "import");
    await db
      .update(listMember)
      .set({
        consentAt: new Date(Date.now() - 86_400_000),
        createdAt: new Date(Date.now() - 86_400_000),
      })
      .where(eq(listMember.address, "old@example.com"));

    const id = await createAutomation(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      name: "Welcome",
    });
    // A wait first, so the pass enrols without trying to send anything.
    await addNode(account.orgId, id, { kind: "wait" });
    await updateAutomation(account.orgId, id, { status: "active" });

    await addMembers(account.orgId, listId, [{ address: "new@example.com" }], "signup form");

    const { runAutomationsOnce } = await import("@/server/automation-runner");
    const pass = await runAutomationsOnce();

    // Switching on a welcome series must not welcome ten thousand people who
    // have been subscribers for two years.
    assert.equal(pass.enrolled, 1);

    const runs = await db
      .select({ id: automationRun.id })
      .from(automationRun)
      .where(eq(automationRun.automationId, id));
    assert.equal(runs.length, 1);
  });

  it("does not enrol anybody while it is still a draft", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { addNode } = await import("@/server/automations");
    const { id, listId } = await anAutomation();
    await addNode(account.orgId, id, { kind: "wait" });
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "signup form");

    const { runAutomationsOnce } = await import("@/server/automation-runner");
    assert.equal((await runAutomationsOnce()).enrolled, 0);
  });

  it("walks straight through the boxes that take no time", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { addNode, updateAutomation, updateNode } = await import("@/server/automations");
    const { db } = await import("@/db");
    const { automationRun, listMember } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { id, listId } = await anAutomation();

    // Set a field, then wait. Both should happen in one pass: a condition or
    // a field write costs nothing, and making somebody wait thirty seconds
    // per box would make a five-box flow take three minutes to start.
    const field = await addNode(account.orgId, id, { kind: "field" });
    await updateNode(account.orgId, field, { config: { field: "stage", value: "welcomed" } });
    const wait = await addNode(account.orgId, id, { kind: "wait", after: field });
    // Something after the wait, or the run would finish at it — a flow that
    // ends in a pause has nothing left to come back for.
    const later = await addNode(account.orgId, id, { kind: "field", after: wait });
    await updateNode(account.orgId, later, { config: { field: "stage", value: "nudged" } });

    await updateAutomation(account.orgId, id, { status: "active" });
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "signup form");

    const { runAutomationsOnce } = await import("@/server/automation-runner");
    await runAutomationsOnce();
    await runAutomationsOnce();

    const [person] = await db
      .select({ fields: listMember.fields })
      .from(listMember)
      .where(eq(listMember.address, "ada@example.com"));
    assert.equal(person?.fields.stage, "welcomed");

    const [run] = await db
      .select({ nextAt: automationRun.nextAt, nodeId: automationRun.nodeId })
      .from(automationRun);
    // Parked past the wait, a day out, rather than still sitting on the field.
    assert.equal(run?.nodeId, later);
    assert.ok(run && run.nextAt.getTime() > Date.now() + 60_000);
  });

  it("takes somebody off the list when the flow says to", async () => {
    const { addMembers, membersView } = await import("@/server/campaigns");
    const { addNode, updateAutomation } = await import("@/server/automations");

    const { id, listId } = await anAutomation();
    await addNode(account.orgId, id, { kind: "unsubscribe" });
    await updateAutomation(account.orgId, id, { status: "active" });
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "signup form");

    const { runAutomationsOnce } = await import("@/server/automation-runner");
    await runAutomationsOnce();
    await runAutomationsOnce();

    const [row] = await membersView(account.orgId, listId);
    assert.equal(row?.status, "unsubscribed");
  });
});
