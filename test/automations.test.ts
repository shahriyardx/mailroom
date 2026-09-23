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
  const { createAutomation, updateAutomation } = await import("@/server/automations");
  const listId = await createList(account.orgId, "Newsletter");
  const id = await createAutomation(account.orgId, { mailboxId: account.mailboxId, name });
  // The trigger is chosen on the canvas rather than at creation, so the
  // ordinary case here is the two calls the editor itself makes.
  await updateAutomation(account.orgId, id, { trigger: "subscribed", listId });
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
      mailboxId: account.mailboxId,
      name: "Welcome",
    });
    await updateAutomation(account.orgId, id, { trigger: "subscribed", listId });
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

describe("boxes that change the person", () => {
  /** A live flow whose first box is the one under test. */
  async function liveWith(
    kind: "tag" | "move",
    config: Record<string, string>,
    address = "pat@example.com",
  ) {
    const { addMembers } = await import("@/server/campaigns");
    const { addNode, updateAutomation, updateNode } = await import("@/server/automations");
    const { id, listId } = await anAutomation();

    const box = await addNode(account.orgId, id, { kind });
    await updateNode(account.orgId, box, { config });
    await updateAutomation(account.orgId, id, { status: "active" });
    await addMembers(account.orgId, listId, [{ address }], "signup form");

    const { runAutomationsOnce } = await import("@/server/automation-runner");
    await runAutomationsOnce();
    return { id, listId, address };
  }

  async function personOn(listId: string, address: string) {
    const { db } = await import("@/db");
    const { listMember } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    return db.query.listMember.findFirst({
      where: and(eq(listMember.listId, listId), eq(listMember.address, address)),
    });
  }

  it("puts a tag on somebody", async () => {
    const { listId, address } = await liveWith("tag", { tagAction: "add", tag: "customer" });
    const person = await personOn(listId, address);
    assert.deepEqual(person?.tags, ["customer"]);
  });

  it("takes one off without minding that it was never there", async () => {
    const { listId, address } = await liveWith("tag", { tagAction: "remove", tag: "customer" });
    const person = await personOn(listId, address);
    assert.deepEqual(person?.tags, []);
  });

  it("copies somebody onto another list and keeps them on this one", async () => {
    const { createList } = await import("@/server/campaigns");
    const other = await createList(account.orgId, "Customers");
    const { listId, address } = await liveWith("move", { listAction: "copy", listId: other });

    assert.equal((await personOn(other, address))?.status, "subscribed");
    // Still here, and still going: a copy is not a departure.
    assert.equal((await personOn(listId, address))?.status, "subscribed");
  });

  it("moving takes them off this list, and off this flow", async () => {
    const { createList } = await import("@/server/campaigns");
    const { db } = await import("@/db");
    const { automationRun } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const other = await createList(account.orgId, "Customers");
    const { id, listId, address } = await liveWith("move", { listAction: "move", listId: other });

    assert.equal((await personOn(other, address))?.status, "subscribed");
    assert.equal((await personOn(listId, address))?.status, "unsubscribed");

    const [run] = await db.select().from(automationRun).where(eq(automationRun.automationId, id));
    // The flow follows this list, so leaving it ends the journey rather than
    // leaving a run pointing at somebody who is gone.
    assert.equal(run?.status, "done");
  });

  it("carries the tags along with a copy", async () => {
    const { addMembers, createList } = await import("@/server/campaigns");
    const { addNode, updateAutomation, updateNode } = await import("@/server/automations");
    const { runAutomationsOnce } = await import("@/server/automation-runner");

    const other = await createList(account.orgId, "Customers");
    const { id, listId } = await anAutomation();

    const tagBox = await addNode(account.orgId, id, { kind: "tag" });
    await updateNode(account.orgId, tagBox, { config: { tagAction: "add", tag: "vip" } });
    const moveBox = await addNode(account.orgId, id, {
      kind: "move",
      after: tagBox,
    });
    await updateNode(account.orgId, moveBox, { config: { listAction: "copy", listId: other } });
    await updateAutomation(account.orgId, id, { status: "active" });
    await addMembers(account.orgId, listId, [{ address: "pat@example.com" }], "signup form");

    await runAutomationsOnce();

    const landed = await personOn(other, "pat@example.com");
    assert.deepEqual(landed?.tags, ["vip"]);
  });

  it("asks a condition about a tag", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { addNode, updateAutomation, updateNode, findAutomation } = await import(
      "@/server/automations"
    );
    const { runAutomationsOnce } = await import("@/server/automation-runner");
    const { db } = await import("@/db");
    const { automationRun } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { id, listId } = await anAutomation();
    const tagBox = await addNode(account.orgId, id, { kind: "tag" });
    await updateNode(account.orgId, tagBox, { config: { tagAction: "add", tag: "vip" } });

    const question = await addNode(account.orgId, id, { kind: "condition", after: tagBox });
    await updateNode(account.orgId, question, { config: { test: "tag", tag: "vip" } });

    const yes = await addNode(account.orgId, id, { kind: "wait", after: question });
    const no = await addNode(account.orgId, id, {
      kind: "wait",
      after: question,
      branch: "nextElse",
    });
    await updateAutomation(account.orgId, id, { status: "active" });
    await addMembers(account.orgId, listId, [{ address: "pat@example.com" }], "signup form");

    await runAutomationsOnce();

    const [run] = await db.select().from(automationRun).where(eq(automationRun.automationId, id));
    // Tagged two boxes earlier in the same pass, so the answer is yes.
    assert.equal(
      run?.nodeId,
      (await findAutomation(account.orgId, id))?.nodes.find((n) => n.id === yes)?.next ?? null,
    );
    assert.notEqual(run?.nodeId, no);
  });
});

describe("waiting until a moment", () => {
  it("holds everybody for the same instant", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { addNode, updateAutomation, updateNode } = await import("@/server/automations");
    const { runAutomationsOnce } = await import("@/server/automation-runner");
    const { db } = await import("@/db");
    const { automationRun } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { id, listId } = await anAutomation();
    const box = await addNode(account.orgId, id, { kind: "wait" });
    const moment = new Date(Date.now() + 3 * 86_400_000);
    await updateNode(account.orgId, box, { waitUntil: moment });
    // Something after it: a wait with nothing following finishes the run
    // rather than holding anybody.
    await addNode(account.orgId, id, { kind: "tag", after: box });
    await updateAutomation(account.orgId, id, { status: "active" });

    await addMembers(
      account.orgId,
      listId,
      [{ address: "early@example.com" }, { address: "late@example.com" }],
      "signup form",
    );
    await runAutomationsOnce();

    const runs = await db.select().from(automationRun).where(eq(automationRun.automationId, id));
    assert.equal(runs.length, 2);
    // Both due at the same moment, however long ago each of them joined.
    for (const run of runs) {
      assert.equal(run.nextAt.getTime(), moment.getTime());
    }
  });

  it("walks straight through a moment that has passed", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { addNode, updateAutomation, updateNode } = await import("@/server/automations");
    const { runAutomationsOnce } = await import("@/server/automation-runner");
    const { db } = await import("@/db");
    const { automationRun } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { id, listId } = await anAutomation();
    const box = await addNode(account.orgId, id, { kind: "wait" });
    await updateNode(account.orgId, box, { waitUntil: new Date(Date.now() - 86_400_000) });
    // Something after it, so there is somewhere to walk to.
    await addNode(account.orgId, id, { kind: "tag", after: box });
    await updateAutomation(account.orgId, id, { status: "active" });
    await addMembers(account.orgId, listId, [{ address: "pat@example.com" }], "signup form");

    await runAutomationsOnce();

    const [run] = await db.select().from(automationRun).where(eq(automationRun.automationId, id));
    // Holding them until the same date next year is the only alternative,
    // and nobody means that.
    assert.equal(run?.status, "done");
  });
});

describe("conditions that ask bigger questions", () => {
  it("asks whether somebody matches a segment", async () => {
    const { addMembers, createList } = await import("@/server/campaigns");
    const { createSegment } = await import("@/server/segments");
    const { addNode, createAutomation, updateAutomation, updateNode } = await import(
      "@/server/automations"
    );
    const { runAutomationsOnce } = await import("@/server/automation-runner");
    const { db } = await import("@/db");
    const { automationRun, listMember } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const listId = await createList(account.orgId, "Newsletter");
    const segmentId = await createSegment(account.orgId, {
      listId,
      name: "On the pro plan",
      rules: [{ field: "fields.plan", op: "is", value: "pro" }],
    });

    const id = await createAutomation(account.orgId, {
      mailboxId: account.mailboxId,
      name: "Ask about a segment",
    });
    const question = await addNode(account.orgId, id, { kind: "condition" });
    await updateNode(account.orgId, question, { config: { test: "segment", segmentId } });
    const yes = await addNode(account.orgId, id, { kind: "tag", after: question });
    await updateNode(account.orgId, yes, { config: { tagAction: "add", tag: "paid" } });
    const no = await addNode(account.orgId, id, {
      kind: "tag",
      after: question,
      branch: "nextElse",
    });
    await updateNode(account.orgId, no, { config: { tagAction: "add", tag: "free" } });

    await updateAutomation(account.orgId, id, { trigger: "subscribed", listId });
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
    await runAutomationsOnce();

    const people = await db.select().from(listMember).where(eq(listMember.listId, listId));
    assert.deepEqual(people.find((row) => row.address === "paid@example.com")?.tags, ["paid"]);
    assert.deepEqual(people.find((row) => row.address === "free@example.com")?.tags, ["free"]);

    const runs = await db.select().from(automationRun).where(eq(automationRun.automationId, id));
    assert.equal(runs.length, 2);
  });

  it("asks whether somebody is on another list", async () => {
    const { addMembers, createList } = await import("@/server/campaigns");
    const { addNode, createAutomation, updateAutomation, updateNode } = await import(
      "@/server/automations"
    );
    const { runAutomationsOnce } = await import("@/server/automation-runner");
    const { db } = await import("@/db");
    const { listMember } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");

    const listId = await createList(account.orgId, "Newsletter");
    const other = await createList(account.orgId, "Customers");
    await addMembers(account.orgId, other, [{ address: "buyer@example.com" }], "import");

    const id = await createAutomation(account.orgId, {
      mailboxId: account.mailboxId,
      name: "Ask about another list",
    });
    const question = await addNode(account.orgId, id, { kind: "condition" });
    await updateNode(account.orgId, question, {
      config: { test: "list", listId: other, op: "is" },
    });
    const yes = await addNode(account.orgId, id, { kind: "tag", after: question });
    await updateNode(account.orgId, yes, { config: { tagAction: "add", tag: "customer" } });

    await updateAutomation(account.orgId, id, { trigger: "subscribed", listId });
    await updateAutomation(account.orgId, id, { status: "active" });

    await addMembers(
      account.orgId,
      listId,
      [{ address: "buyer@example.com" }, { address: "stranger@example.com" }],
      "signup form",
    );
    await runAutomationsOnce();

    // Asked by address: the same person is a different row on every list.
    const [buyer] = await db
      .select()
      .from(listMember)
      .where(and(eq(listMember.listId, listId), eq(listMember.address, "buyer@example.com")));
    const [stranger] = await db
      .select()
      .from(listMember)
      .where(and(eq(listMember.listId, listId), eq(listMember.address, "stranger@example.com")));

    assert.deepEqual(buyer?.tags, ["customer"]);
    assert.deepEqual(stranger?.tags, []);
  });
});

describe("what the flow sent, and what came back", () => {
  /** A flow whose first box asks about its own last email. */
  async function asking(test: "opened" | "clicked") {
    const { addMembers } = await import("@/server/campaigns");
    const { addNode, updateAutomation, updateNode } = await import("@/server/automations");
    const { id, listId } = await anAutomation();

    const question = await addNode(account.orgId, id, { kind: "condition" });
    await updateNode(account.orgId, question, { config: { test } });
    const yes = await addNode(account.orgId, id, { kind: "tag", after: question });
    await updateNode(account.orgId, yes, { config: { tagAction: "add", tag: "engaged" } });
    const no = await addNode(account.orgId, id, {
      kind: "tag",
      after: question,
      branch: "nextElse",
    });
    await updateNode(account.orgId, no, { config: { tagAction: "add", tag: "quiet" } });

    await updateAutomation(account.orgId, id, { status: "active" });
    await addMembers(account.orgId, listId, [{ address: "pat@example.com" }], "signup form");

    const { db } = await import("@/db");
    const { listMember } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const person = await db.query.listMember.findFirst({
      where: and(eq(listMember.listId, listId), eq(listMember.address, "pat@example.com")),
    });

    return { id, listId, memberId: person?.id ?? "" };
  }

  /** An email this flow sent earlier, with whatever came back written on it. */
  async function pretendSent(
    automationId: string,
    memberId: string,
    stamps: { openedAt?: Date; clickedAt?: Date } = {},
  ) {
    const { db } = await import("@/db");
    const { automationSend } = await import("@/db/schema");
    const { newId } = await import("@/lib/utils");
    await db.insert(automationSend).values({
      id: newId("ase"),
      organizationId: account.orgId,
      automationId,
      listMemberId: memberId,
      address: "pat@example.com",
      subject: "The first one",
      ...stamps,
    });
  }

  async function tagsOf(memberId: string) {
    const { db } = await import("@/db");
    const { listMember } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const row = await db.query.listMember.findFirst({ where: eq(listMember.id, memberId) });
    return row?.tags ?? [];
  }

  it("counts an open of its own email, which campaign rows never knew about", async () => {
    const { runAutomationsOnce } = await import("@/server/automation-runner");
    const { id, memberId } = await asking("opened");
    await pretendSent(id, memberId, { openedAt: new Date() });

    await runAutomationsOnce();

    // This is the branch every drip hangs on. It used to read the campaign
    // tables, which an automation never writes to, and answered no forever.
    assert.deepEqual(await tagsOf(memberId), ["engaged"]);
  });

  it("takes the no branch when its email went unopened", async () => {
    const { runAutomationsOnce } = await import("@/server/automation-runner");
    const { id, memberId } = await asking("opened");
    await pretendSent(id, memberId);

    await runAutomationsOnce();
    assert.deepEqual(await tagsOf(memberId), ["quiet"]);
  });

  it("reads the last one it sent, not the first", async () => {
    const { runAutomationsOnce } = await import("@/server/automation-runner");
    const { id, memberId } = await asking("opened");
    await pretendSent(id, memberId, { openedAt: new Date(Date.now() - 86_400_000) });
    await pretendSent(id, memberId);

    await runAutomationsOnce();
    assert.deepEqual(await tagsOf(memberId), ["quiet"]);
  });

  it("says no when the flow has not written to them at all", async () => {
    const { runAutomationsOnce } = await import("@/server/automation-runner");
    const { memberId } = await asking("clicked");

    await runAutomationsOnce();
    // Not "they ignored it" — they were never sent anything — but no is the
    // honest answer to "did they click it".
    assert.deepEqual(await tagsOf(memberId), ["quiet"]);
  });

  it("counts each box separately", async () => {
    const { addNode } = await import("@/server/automations");
    const { stepTallies } = await import("@/server/automations");
    const { db } = await import("@/db");
    const { automationSend } = await import("@/db/schema");
    const { newId } = await import("@/lib/utils");
    const { addMembers } = await import("@/server/campaigns");
    const { listMember } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { id, listId } = await anAutomation();
    const first = await addNode(account.orgId, id, { kind: "email" });
    const second = await addNode(account.orgId, id, { kind: "email", after: first });
    await addMembers(
      account.orgId,
      listId,
      [{ address: "a@example.com" }, { address: "b@example.com" }],
      "import",
    );
    const people = await db.select().from(listMember).where(eq(listMember.listId, listId));

    for (const person of people) {
      await db.insert(automationSend).values({
        id: newId("ase"),
        organizationId: account.orgId,
        automationId: id,
        nodeId: first,
        listMemberId: person.id,
        address: person.address,
        openedAt: person.address === "a@example.com" ? new Date() : null,
      });
    }
    await db.insert(automationSend).values({
      id: newId("ase"),
      organizationId: account.orgId,
      automationId: id,
      nodeId: second,
      listMemberId: people[0]?.id ?? "",
      address: "a@example.com",
      openedAt: new Date(),
      clickedAt: new Date(),
    });

    const tallies = await stepTallies(account.orgId, id);
    assert.deepEqual(tallies[first], { sent: 2, opened: 1, clicked: 0 });
    assert.deepEqual(tallies[second], { sent: 1, opened: 1, clicked: 1 });
  });
});

describe("letting somebody out early", () => {
  it("stops the run the moment they match the goal", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { createSegment } = await import("@/server/segments");
    const { addNode, updateAutomation, updateNode } = await import("@/server/automations");
    const { runAutomationsOnce } = await import("@/server/automation-runner");
    const { db } = await import("@/db");
    const { automationRun, listMember } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");

    const { id, listId } = await anAutomation();
    const wait = await addNode(account.orgId, id, { kind: "wait" });
    await updateNode(account.orgId, wait, { delayMinutes: 60 });
    const after = await addNode(account.orgId, id, { kind: "tag", after: wait });
    await updateNode(account.orgId, after, { config: { tagAction: "add", tag: "nagged" } });

    const exitSegmentId = await createSegment(account.orgId, {
      listId,
      name: "Bought something",
      rules: [{ field: "tags", op: "has", value: "customer" }],
    });
    await updateAutomation(account.orgId, id, { exitSegmentId });
    await updateAutomation(account.orgId, id, { status: "active" });

    await addMembers(account.orgId, listId, [{ address: "pat@example.com" }], "signup form");
    await runAutomationsOnce();

    // They buy while sitting in the wait.
    const person = await db.query.listMember.findFirst({
      where: and(eq(listMember.listId, listId), eq(listMember.address, "pat@example.com")),
    });
    await db
      .update(listMember)
      .set({ tags: ["customer"] })
      .where(eq(listMember.id, person?.id ?? ""));
    await db
      .update(automationRun)
      .set({ nextAt: new Date(Date.now() - 1000) })
      .where(eq(automationRun.automationId, id));

    await runAutomationsOnce();

    const [run] = await db.select().from(automationRun).where(eq(automationRun.automationId, id));
    assert.equal(run?.status, "stopped");
    assert.match(run?.stoppedReason ?? "", /Bought something/);

    // And the box after the wait never ran for them.
    const settled = await db.query.listMember.findFirst({
      where: eq(listMember.id, person?.id ?? ""),
    });
    assert.deepEqual(settled?.tags, ["customer"]);
  });
});

describe("a flow before it has an address", () => {
  it("is created with no mailbox at all", async () => {
    const { createAutomation, findAutomation } = await import("@/server/automations");
    const id = await createAutomation(account.orgId, { name: "Welcome" });

    const row = await findAutomation(account.orgId, id);
    assert.equal(row?.mailboxId, null);
    assert.equal(row?.status, "draft");
  });

  it("refuses to switch on until one is chosen", async () => {
    const { addNode, createAutomation, updateAutomation } = await import("@/server/automations");
    const { createList } = await import("@/server/campaigns");

    const listId = await createList(account.orgId, "Newsletter");
    const id = await createAutomation(account.orgId, { name: "Welcome" });
    await updateAutomation(account.orgId, id, { trigger: "subscribed", listId });
    await addNode(account.orgId, id, { kind: "wait" });

    await assert.rejects(
      () => updateAutomation(account.orgId, id, { status: "active" }),
      /address/,
    );
  });

  it("switches on once it has one", async () => {
    const { addNode, createAutomation, findAutomation, updateAutomation } = await import(
      "@/server/automations"
    );
    const { createList } = await import("@/server/campaigns");

    const listId = await createList(account.orgId, "Newsletter");
    const id = await createAutomation(account.orgId, { name: "Welcome" });
    await updateAutomation(account.orgId, id, { trigger: "subscribed", listId });
    await addNode(account.orgId, id, { kind: "wait" });
    await updateAutomation(account.orgId, id, {
      mailboxId: account.mailboxId,
      status: "active",
    });

    assert.equal((await findAutomation(account.orgId, id))?.status, "active");
  });
});
