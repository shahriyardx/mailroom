import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { newId } from "@/lib/utils";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * Who gets told that mail arrived.
 *
 * A desktop notification carries a sender and a subject line onto somebody's
 * screen, so the question "who may be told about this mailbox" is the same
 * question as "who may read it" and has to give the same answer. Asked from
 * the other end, though: the app usually starts from a person, and this
 * starts from a mailbox. Two implementations of one rule is exactly where a
 * leak hides, which is what these are here to catch.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("push_readers");
  account = await seedAccount();
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { accessGrant, member, team, teamMember } = await import("@/db/schema");
  await db.delete(accessGrant);
  await db.delete(teamMember);
  await db.delete(team);
  await db.delete(member);
});

/** Somebody in the account, with no rights beyond belonging to it. */
async function addPerson(role: "owner" | "admin" | "member") {
  const { db } = await import("@/db");
  const { member, user } = await import("@/db/schema");

  const userId = newId("usr");
  const memberId = newId("mem");

  await db.insert(user).values({
    id: userId,
    name: `A ${role}`,
    email: `${memberId}@example.test`,
    emailVerified: true,
  });
  await db.insert(member).values({
    id: memberId,
    organizationId: account.orgId,
    userId,
    role,
  });

  return { userId, memberId };
}

async function grant(
  subject: { type: "member" | "team"; id: string },
  resource: { type: "mailbox" | "domain"; id: string },
  canRead: boolean,
) {
  const { db } = await import("@/db");
  const { accessGrant } = await import("@/db/schema");

  await db.insert(accessGrant).values({
    id: newId("grn"),
    organizationId: account.orgId,
    subjectType: subject.type,
    subjectId: subject.id,
    resourceType: resource.type,
    resourceId: resource.id,
    canRead,
    canSend: false,
    canManage: false,
  });
}

describe("who may be told about a mailbox", () => {
  it("tells the owner, who reaches everything", async () => {
    const { readersOf } = await import("@/server/push");
    const owner = await addPerson("owner");

    const readers = await readersOf(account.orgId, account.mailboxId);
    assert.deepEqual(readers, [owner.userId]);
  });

  it("does not tell an admin, who runs the place but does not read the mail", async () => {
    const { readersOf } = await import("@/server/push");
    await addPerson("admin");

    const readers = await readersOf(account.orgId, account.mailboxId);
    assert.deepEqual(readers, []);
  });

  it("does not tell a member with no grant", async () => {
    const { readersOf } = await import("@/server/push");
    await addPerson("member");

    const readers = await readersOf(account.orgId, account.mailboxId);
    assert.deepEqual(readers, []);
  });

  it("tells a member granted the mailbox", async () => {
    const { readersOf } = await import("@/server/push");
    const person = await addPerson("member");
    await grant(
      { type: "member", id: person.memberId },
      { type: "mailbox", id: account.mailboxId },
      true,
    );

    const readers = await readersOf(account.orgId, account.mailboxId);
    assert.deepEqual(readers, [person.userId]);
  });

  it("does not tell a member whose grant cannot read", async () => {
    const { readersOf } = await import("@/server/push");
    const person = await addPerson("member");
    // A send-only grant: they may write as the address without seeing what
    // arrives in it, and a notification would be exactly that.
    await grant(
      { type: "member", id: person.memberId },
      { type: "mailbox", id: account.mailboxId },
      false,
    );

    const readers = await readersOf(account.orgId, account.mailboxId);
    assert.deepEqual(readers, []);
  });

  it("tells a team granted the domain", async () => {
    const { db } = await import("@/db");
    const { team, teamMember } = await import("@/db/schema");
    const { readersOf } = await import("@/server/push");

    const person = await addPerson("member");
    const teamId = newId("tem");

    await db.insert(team).values({ id: teamId, organizationId: account.orgId, name: "Support" });
    await db.insert(teamMember).values({
      id: newId("tmb"),
      teamId,
      userId: person.userId,
      role: "member",
    });
    await grant({ type: "team", id: teamId }, { type: "domain", id: account.domainId }, true);

    const readers = await readersOf(account.orgId, account.mailboxId);
    assert.deepEqual(readers, [person.userId]);
  });

  it("tells everybody in the root team without a grant", async () => {
    const { db } = await import("@/db");
    const { team, teamMember } = await import("@/db/schema");
    const { readersOf } = await import("@/server/push");

    const person = await addPerson("member");
    const teamId = newId("tem");

    await db
      .insert(team)
      .values({ id: teamId, organizationId: account.orgId, name: "Root", isRoot: true });
    await db.insert(teamMember).values({
      id: newId("tmb"),
      teamId,
      userId: person.userId,
      role: "member",
    });

    const readers = await readersOf(account.orgId, account.mailboxId);
    assert.deepEqual(readers, [person.userId]);
  });

  it("does not tell somebody granted a different mailbox", async () => {
    const { db } = await import("@/db");
    const { mailbox } = await import("@/db/schema");
    const { readersOf } = await import("@/server/push");

    const otherId = newId("mbx");
    await db.insert(mailbox).values({
      id: otherId,
      organizationId: account.orgId,
      domainId: account.domainId,
      address: "other@example.test",
      domain: "example.test",
      displayName: "Other",
    });

    const person = await addPerson("member");
    await grant({ type: "member", id: person.memberId }, { type: "mailbox", id: otherId }, true);

    const readers = await readersOf(account.orgId, account.mailboxId);
    assert.deepEqual(readers, []);
  });

  it("says nothing about a mailbox in another account", async () => {
    const { readersOf } = await import("@/server/push");
    await addPerson("owner");

    const readers = await readersOf(newId("org"), account.mailboxId);
    assert.deepEqual(readers, []);
  });
});
