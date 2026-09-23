import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { newId } from "@/lib/utils";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * Who may reach which audience.
 *
 * A mailing list is the most sensitive thing in the product: real people who
 * agreed to hear from you once. Until there were grants over them, reaching
 * one meant being an administrator of the whole instance, so every one of
 * these is about somebody who is not.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("campaign_access");
  account = await seedAccount();
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { accessGrant, automation, broadcast, listMember, mailingList } = await import(
    "@/db/schema"
  );
  await db.delete(accessGrant);
  await db.delete(automation);
  await db.delete(broadcast);
  await db.delete(listMember);
  await db.delete(mailingList);
});

/** Somebody signed in. Built here rather than seeded, since only these fields are read. */
function who(over: Partial<{ role: string; isRoot: boolean; teamIds: string[] }> = {}) {
  return {
    userId: account.userId,
    name: "Someone",
    email: "someone@example.test",
    orgId: account.orgId,
    memberId: "mbr_someone",
    role: (over.role ?? "member") as "owner" | "admin" | "member",
    teamIds: over.teamIds ?? [],
    leadsTeamIds: [],
    isRoot: over.isRoot ?? false,
  };
}

async function aList(name = "Newsletter") {
  const { createList } = await import("@/server/campaigns");
  return createList(account.orgId, name);
}

async function grant(input: {
  subjectType: "member" | "team";
  subjectId: string;
  resourceType: "list" | "lists";
  resourceId: string;
  canRead?: boolean;
  canSend?: boolean;
  canManage?: boolean;
}) {
  const { db } = await import("@/db");
  const { accessGrant } = await import("@/db/schema");
  await db.insert(accessGrant).values({
    id: newId("grant"),
    organizationId: account.orgId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    canRead: input.canRead ?? true,
    canSend: input.canSend ?? false,
    canManage: input.canManage ?? false,
  });
}

describe("who reaches a list without a grant", () => {
  it("whoever runs the instance reaches all of them", async () => {
    const { campaignReach } = await import("@/server/campaign-access");
    const listId = await aList();

    const reach = await campaignReach(who({ isRoot: true }));
    assert.equal(reach.everything, true);
    assert.equal(reach.canCreate, true);
    assert.deepEqual(reach.rights.get(listId), { read: true, send: true, manage: true });
  });

  it("an administrator does too, because a list is company property", async () => {
    const { campaignReach } = await import("@/server/campaign-access");
    await aList();
    const reach = await campaignReach(who({ role: "admin" }));
    assert.equal(reach.everything, true);
  });

  it("a plain member reaches nothing at all", async () => {
    const { campaignReach, hasCampaignAccess } = await import("@/server/campaign-access");
    await aList();

    const reach = await campaignReach(who());
    assert.equal(reach.rights.size, 0);
    assert.equal(reach.canCreate, false);
    assert.equal(await hasCampaignAccess(who()), false);
  });
});

describe("a grant on one list", () => {
  it("reaches that list and no other", async () => {
    const { listRights, readableLists } = await import("@/server/campaign-access");
    const mine = await aList("Mine");
    const theirs = await aList("Theirs");
    await grant({
      subjectType: "member",
      subjectId: "mbr_someone",
      resourceType: "list",
      resourceId: mine,
    });

    assert.deepEqual(await listRights(who(), mine), { read: true, send: false, manage: false });
    assert.deepEqual(await listRights(who(), theirs), { read: false, send: false, manage: false });
    assert.deepEqual(await readableLists(who()), [mine]);
  });

  it("refuses to send or to manage until those are granted too", async () => {
    const { assertCanManageList, assertCanSendToList } = await import("@/server/campaign-access");
    const listId = await aList();
    await grant({
      subjectType: "member",
      subjectId: "mbr_someone",
      resourceType: "list",
      resourceId: listId,
    });

    await assert.rejects(() => assertCanSendToList(who(), listId), /cannot send/);
    await assert.rejects(() => assertCanManageList(who(), listId), /cannot change/);
  });

  it("allows what it does say", async () => {
    const { assertCanSendToList } = await import("@/server/campaign-access");
    const listId = await aList();
    await grant({
      subjectType: "member",
      subjectId: "mbr_someone",
      resourceType: "list",
      resourceId: listId,
      canSend: true,
    });

    await assertCanSendToList(who(), listId);
  });

  it("a campaign with no list yet is nobody's audience, so it is let through", async () => {
    const { assertCanSendToList } = await import("@/server/campaign-access");
    await assertCanSendToList(who(), null);
  });
});

describe("a grant through a team", () => {
  it("reaches what the team was given", async () => {
    const { listRights } = await import("@/server/campaign-access");
    const listId = await aList();
    await grant({
      subjectType: "team",
      subjectId: "tem_marketing",
      resourceType: "list",
      resourceId: listId,
      canSend: true,
    });

    const rights = await listRights(who({ teamIds: ["tem_marketing"] }), listId);
    assert.equal(rights.send, true);
    // And nothing, for somebody who is not in that team.
    assert.equal((await listRights(who(), listId)).read, false);
  });

  it("adds to what the person was given rather than replacing it", async () => {
    const { listRights } = await import("@/server/campaign-access");
    const listId = await aList();
    await grant({
      subjectType: "member",
      subjectId: "mbr_someone",
      resourceType: "list",
      resourceId: listId,
      canSend: true,
    });
    await grant({
      subjectType: "team",
      subjectId: "tem_marketing",
      resourceType: "list",
      resourceId: listId,
      canManage: true,
    });

    const rights = await listRights(who({ teamIds: ["tem_marketing"] }), listId);
    assert.deepEqual(rights, { read: true, send: true, manage: true });
  });
});

describe("a grant on every list", () => {
  it("covers a list made after it", async () => {
    const { listRights } = await import("@/server/campaign-access");
    await grant({
      subjectType: "member",
      subjectId: "mbr_someone",
      resourceType: "lists",
      resourceId: "*",
      canSend: true,
    });

    const later = await aList("Made afterwards");
    assert.equal((await listRights(who(), later)).send, true);
  });

  it("managing all of them is the right to make another", async () => {
    const { assertCanCreateList, campaignReach } = await import("@/server/campaign-access");
    await grant({
      subjectType: "member",
      subjectId: "mbr_someone",
      resourceType: "lists",
      resourceId: "*",
      canManage: true,
    });

    assert.equal((await campaignReach(who())).canCreate, true);
    await assertCanCreateList(who());
  });

  it("reading all of them is not", async () => {
    const { assertCanCreateList } = await import("@/server/campaign-access");
    await grant({
      subjectType: "member",
      subjectId: "mbr_someone",
      resourceType: "lists",
      resourceId: "*",
    });

    await assert.rejects(() => assertCanCreateList(who()), /cannot create/);
  });
});

describe("what the screens show", () => {
  it("only the lists somebody may see", async () => {
    const { listsView } = await import("@/server/campaigns");
    const mine = await aList("Mine");
    await aList("Theirs");

    const shown = await listsView(account.orgId, [mine]);
    assert.deepEqual(
      shown.map((row) => row.name),
      ["Mine"],
    );

    // Nothing granted is not the same as no filter.
    assert.deepEqual(await listsView(account.orgId, []), []);
  });

  it("a campaign aimed at a list they cannot see is not listed", async () => {
    const { broadcastsView, createBroadcast } = await import("@/server/campaigns");
    const mine = await aList("Mine");
    const theirs = await aList("Theirs");

    await createBroadcast(account.orgId, { listId: mine, subject: "Ours" });
    await createBroadcast(account.orgId, { listId: theirs, subject: "Theirs" });
    // A draft aimed nowhere yet belongs to nobody's audience.
    await createBroadcast(account.orgId, { subject: "Not aimed yet" });

    const shown = await broadcastsView(account.orgId, [mine]);
    assert.deepEqual(shown.map((row) => row.subject).sort(), ["Not aimed yet", "Ours"]);
  });

  it("and neither is an automation on one", async () => {
    const { automationsView } = await import("@/server/automations");
    const { createAutomation } = await import("@/server/automations");
    const { db } = await import("@/db");
    const { automation } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const mine = await aList("Mine");
    const theirs = await aList("Theirs");

    const ours = await createAutomation(account.orgId, { name: "Ours" });
    const other = await createAutomation(account.orgId, { name: "Theirs" });
    await db.update(automation).set({ listId: mine }).where(eq(automation.id, ours));
    await db.update(automation).set({ listId: theirs }).where(eq(automation.id, other));

    const shown = await automationsView(account.orgId, [mine]);
    assert.deepEqual(
      shown.map((row) => row.name),
      ["Ours"],
    );
  });

  it("an automation with no address on it is still listed", async () => {
    const { automationsView, createAutomation } = await import("@/server/automations");
    await createAutomation(account.orgId, { name: "No address yet" });

    const shown = await automationsView(account.orgId);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].from, null);
  });
});
