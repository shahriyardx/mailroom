import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * Lists, consent, and getting off one.
 *
 * Three things here are load-bearing and none is obvious from the tables.
 * Re-importing a file must not resubscribe somebody who left, which is the
 * most common way a sender ends up in a spam folder. Unsubscribing is per
 * list, not per person. And the audience for a broadcast is frozen when it
 * starts, so what went out can be explained afterwards.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("campaigns");
  account = await seedAccount();
  process.env.BETTER_AUTH_SECRET ??= "test-secret-for-campaign-tests";
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { broadcast, broadcastRecipient, listMember, mailingList } = await import("@/db/schema");
  await db.delete(broadcastRecipient);
  await db.delete(broadcast);
  await db.delete(listMember);
  await db.delete(mailingList);
});

async function aList(name = "Newsletter") {
  const { createList } = await import("@/server/campaigns");
  return createList(account.orgId, name);
}

describe("putting people on a list", () => {
  it("records where the consent came from", async () => {
    const { addMembers, membersView } = await import("@/server/campaigns");
    const listId = await aList();
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "signup form");

    const [row] = await membersView(account.orgId, listId);
    assert.equal(row?.consentSource, "signup form");
    assert.notEqual(row?.consentAt, null);
  });

  it("drops anything that is not an address", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const listId = await aList();
    const result = await addMembers(
      account.orgId,
      listId,
      [{ address: "ada@example.com" }, { address: "not-an-address" }],
      "import",
    );

    assert.equal(result.added, 1);
    assert.equal(result.rejected, 1);
  });

  it("counts the same address twice in one file only once", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const listId = await aList();
    const result = await addMembers(
      account.orgId,
      listId,
      [{ address: "ada@example.com" }, { address: "ADA@example.com" }],
      "import",
    );

    assert.equal(result.added, 1);
  });

  it("never resubscribes somebody who left", async () => {
    const { addMembers, membersView, setMemberStatus } = await import("@/server/campaigns");
    // The whole point. Re-importing last month's file must not undo an
    // unsubscribe, which is how a sender earns a spam complaint.
    const listId = await aList();
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "import");

    const [before] = await membersView(account.orgId, listId);
    assert.ok(before);
    await setMemberStatus(account.orgId, before.id, "unsubscribed");

    const again = await addMembers(
      account.orgId,
      listId,
      [{ address: "ada@example.com" }],
      "import",
    );
    assert.equal(again.added, 0);
    assert.equal(again.skipped, 1);

    const [after_] = await membersView(account.orgId, listId);
    assert.equal(after_?.status, "unsubscribed");
  });
});

describe("the unsubscribe link", () => {
  it("takes somebody off the list it was made for", async () => {
    const { addMembers, membersView, unsubscribeByToken, unsubscribeToken } = await import(
      "@/server/campaigns"
    );
    const listId = await aList();
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "import");
    const [row] = await membersView(account.orgId, listId);
    assert.ok(row);

    const result = await unsubscribeByToken(unsubscribeToken(row.id));
    assert.equal(result?.address, "ada@example.com");

    const [after_] = await membersView(account.orgId, listId);
    assert.equal(after_?.status, "unsubscribed");
  });

  it("refuses a token somebody edited", async () => {
    const { addMembers, membersView, unsubscribeByToken, unsubscribeToken } = await import(
      "@/server/campaigns"
    );
    const listId = await aList();
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "import");
    const [row] = await membersView(account.orgId, listId);
    assert.ok(row);

    // Swapping in another member's id has to fail, or one link unsubscribes
    // anybody whose id you can guess.
    const token = unsubscribeToken(row.id);
    const forged = token.replace(row.id, "lsm_somebodyelse");

    assert.equal(await unsubscribeByToken(forged), null);
  });

  it("leaves the same address on a different list alone", async () => {
    const { addMembers, membersView, unsubscribeByToken, unsubscribeToken } = await import(
      "@/server/campaigns"
    );
    const newsletter = await aList("Newsletter");
    const releases = await aList("Release notes");
    await addMembers(account.orgId, newsletter, [{ address: "ada@example.com" }], "import");
    await addMembers(account.orgId, releases, [{ address: "ada@example.com" }], "import");

    const [onNewsletter] = await membersView(account.orgId, newsletter);
    assert.ok(onNewsletter);
    await unsubscribeByToken(unsubscribeToken(onNewsletter.id));

    const [onReleases] = await membersView(account.orgId, releases);
    assert.equal(onReleases?.status, "subscribed");
  });

  it("says it worked the second time too", async () => {
    const { addMembers, membersView, unsubscribeByToken, unsubscribeToken } = await import(
      "@/server/campaigns"
    );
    const listId = await aList();
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "import");
    const [row] = await membersView(account.orgId, listId);
    assert.ok(row);

    const token = unsubscribeToken(row.id);
    await unsubscribeByToken(token);
    // A second click must not look like a failure.
    assert.notEqual(await unsubscribeByToken(token), null);
  });
});

describe("starting a broadcast", () => {
  it("writes a row for everyone subscribed, and nobody else", async () => {
    const { addMembers, createBroadcast, membersView, setMemberStatus, startBroadcast } =
      await import("@/server/campaigns");
    const listId = await aList();
    await addMembers(
      account.orgId,
      listId,
      [{ address: "ada@example.com" }, { address: "bob@example.com" }],
      "import",
    );

    const rows = await membersView(account.orgId, listId);
    const bob = rows.find((row) => row.address === "bob@example.com");
    assert.ok(bob);
    await setMemberStatus(account.orgId, bob.id, "unsubscribed");

    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Hello",
    });
    const result = await startBroadcast(account.orgId, id);

    assert.equal(result.recipients, 1);
  });

  it("refuses when nobody is subscribed", async () => {
    const { createBroadcast, startBroadcast } = await import("@/server/campaigns");
    const listId = await aList();
    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Hello",
    });

    await assert.rejects(() => startBroadcast(account.orgId, id), /Nobody/);
  });

  it("cannot be started twice", async () => {
    const { addMembers, createBroadcast, startBroadcast } = await import("@/server/campaigns");
    const listId = await aList();
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "import");

    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Hello",
    });
    await startBroadcast(account.orgId, id);

    await assert.rejects(() => startBroadcast(account.orgId, id), /already been started/);
  });
});

describe("reading a file somebody uploaded", () => {
  it("takes one address per line", async () => {
    const { parseMemberList } = await import("@/server/campaigns");
    const people = parseMemberList("ada@example.com\nbob@example.com");

    assert.deepEqual(
      people.map((person) => person.address),
      ["ada@example.com", "bob@example.com"],
    );
  });

  it("takes an address and a name", async () => {
    const { parseMemberList } = await import("@/server/campaigns");
    const [person] = parseMemberList("ada@example.com, Ada Lovelace");

    assert.equal(person?.address, "ada@example.com");
    assert.equal(person?.name, "Ada Lovelace");
  });

  it("keeps a quoted name with a comma in it whole", async () => {
    const { parseMemberList } = await import("@/server/campaigns");
    // Every export from every other tool quotes names like this. Splitting on
    // commas alone turns a normal file into nonsense.
    const [person] = parseMemberList('ada@example.com,"Lovelace, Ada"');

    assert.equal(person?.name, "Lovelace, Ada");
  });

  it("uses a header row when the file has one", async () => {
    const { parseMemberList } = await import("@/server/campaigns");
    const [person] = parseMemberList("name,email\nAda Lovelace,ada@example.com");

    assert.equal(person?.address, "ada@example.com");
    assert.equal(person?.name, "Ada Lovelace");
  });

  it("keeps the other columns as merge fields", async () => {
    const { parseMemberList } = await import("@/server/campaigns");
    const [person] = parseMemberList("email,name,plan\nada@example.com,Ada,pro");

    assert.deepEqual(person?.fields, { plan: "pro" });
  });

  it("does not eat the first line when there is no header", async () => {
    const { parseMemberList } = await import("@/server/campaigns");
    // A file with no header starts with a real person, and losing them is a
    // silent wrong answer rather than an error anybody would notice.
    const people = parseMemberList("ada@example.com\nbob@example.com");
    assert.equal(people.length, 2);
  });
});
