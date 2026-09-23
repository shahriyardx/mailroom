import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * Series that run on the subscriber's clock.
 *
 * Two rules here are load-bearing. Step positions stay contiguous, because a
 * run stores the index it is waiting on and a hole in the numbering strands
 * everybody sitting past it. And an automation with no emails cannot be
 * switched on, because enrolling somebody into nothing marks them done — and
 * done people are never enrolled again once the emails are written.
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
  const { automation, automationRun, automationStep, listMember, mailingList } = await import(
    "@/db/schema"
  );
  await db.delete(automationRun);
  await db.delete(automationStep);
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

describe("building a series", () => {
  it("appends each email to the end", async () => {
    const { addStep, findAutomation } = await import("@/server/automations");
    const { id } = await anAutomation();

    await addStep(account.orgId, id, { subject: "First", delayMinutes: 0 });
    await addStep(account.orgId, id, { subject: "Second", delayMinutes: 1440 });

    const row = await findAutomation(account.orgId, id);
    assert.deepEqual(
      row?.steps.map((step) => [step.position, step.subject]),
      [
        [0, "First"],
        [1, "Second"],
      ],
    );
  });

  it("closes the gap when one is removed from the middle", async () => {
    const { addStep, findAutomation, removeStep } = await import("@/server/automations");
    const { id } = await anAutomation();

    await addStep(account.orgId, id, { subject: "First" });
    const middle = await addStep(account.orgId, id, { subject: "Second" });
    await addStep(account.orgId, id, { subject: "Third" });

    await removeStep(account.orgId, middle);

    const row = await findAutomation(account.orgId, id);
    // Contiguous, or everybody waiting past the hole is stranded forever.
    assert.deepEqual(
      row?.steps.map((step) => [step.position, step.subject]),
      [
        [0, "First"],
        [1, "Third"],
      ],
    );
  });

  it("will not let a negative wait through", async () => {
    const { addStep, findAutomation, updateStep } = await import("@/server/automations");
    const { id } = await anAutomation();
    const step = await addStep(account.orgId, id, { subject: "First" });

    await updateStep(account.orgId, step, { delayMinutes: -60 });
    const row = await findAutomation(account.orgId, id);
    assert.equal(row?.steps[0]?.delayMinutes, 0);
  });

  it("compiles a design into the body, like everything else here", async () => {
    const { emptyDesign, newBlock } = await import("@/lib/email-blocks");
    const { addStep, findAutomation, updateStep } = await import("@/server/automations");
    const { id } = await anAutomation();
    const step = await addStep(account.orgId, id, { subject: "First" });

    await updateStep(account.orgId, step, {
      design: {
        ...emptyDesign(),
        blocks: [{ ...newBlock("heading", "b1"), text: "Welcome" }],
      } as never,
    });

    const row = await findAutomation(account.orgId, id);
    assert.ok(row?.steps[0]?.html?.includes("Welcome"));
    assert.equal(row?.steps[0]?.text, "Welcome");
  });
});

describe("switching one on", () => {
  it("refuses while it has no emails in it", async () => {
    const { updateAutomation } = await import("@/server/automations");
    const { id } = await anAutomation();

    // Otherwise everybody who joins is enrolled into nothing and marked done,
    // which quietly means they can never be enrolled once it is written.
    await assert.rejects(() => updateAutomation(account.orgId, id, { status: "active" }));
  });

  it("allows it once there is something to send", async () => {
    const { addStep, automationsView, updateAutomation } = await import("@/server/automations");
    const { id } = await anAutomation();
    await addStep(account.orgId, id, { subject: "Hello" });

    await updateAutomation(account.orgId, id, { status: "active" });
    const [row] = await automationsView(account.orgId);
    assert.equal(row?.status, "active");
    assert.equal(row?.steps, 1);
  });
});

describe("who gets put through it", () => {
  it("enrols somebody who joins after it was made, and nobody who was already there", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { addStep, updateAutomation } = await import("@/server/automations");
    const { db } = await import("@/db");
    const { automationRun, listMember } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { createList } = await import("@/server/campaigns");
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

    const { createAutomation } = await import("@/server/automations");
    const id = await createAutomation(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      name: "Welcome",
    });
    await addStep(account.orgId, id, { subject: "Hello", delayMinutes: 60 });
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
    const { addStep } = await import("@/server/automations");
    const { id, listId } = await anAutomation();
    await addStep(account.orgId, id, { subject: "Hello" });
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "signup form");

    const { runAutomationsOnce } = await import("@/server/automation-runner");
    assert.equal((await runAutomationsOnce()).enrolled, 0);
  });
});
