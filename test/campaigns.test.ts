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
  const { broadcast, broadcastClick, broadcastRecipient, listMember, mailingList, segment } =
    await import("@/db/schema");
  await db.delete(broadcastClick);
  await db.delete(broadcastRecipient);
  await db.delete(broadcast);
  await db.delete(segment);
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

describe("subscribing from a signup form", () => {
  it("adds somebody new", async () => {
    const { subscribe } = await import("@/server/campaigns");
    const listId = await aList();
    const result = await subscribe(
      account.orgId,
      listId,
      { address: "ada@example.com" },
      "signup form",
    );

    assert.equal(result.status, "subscribed");
  });

  it("says so when they are already on it", async () => {
    const { subscribe } = await import("@/server/campaigns");
    const listId = await aList();
    await subscribe(account.orgId, listId, { address: "ada@example.com" }, "signup form");
    const again = await subscribe(
      account.orgId,
      listId,
      { address: "ada@example.com" },
      "signup form",
    );

    assert.equal(again.status, "already");
  });

  it("lets somebody who left sign up again", async () => {
    const { membersView, setMemberStatus, subscribe } = await import("@/server/campaigns");
    // The one thing that should undo an unsubscribe is the person themselves
    // asking again. An import must never do it; this must.
    const listId = await aList();
    await subscribe(account.orgId, listId, { address: "ada@example.com" }, "signup form");

    const [row] = await membersView(account.orgId, listId);
    assert.ok(row);
    await setMemberStatus(account.orgId, row.id, "unsubscribed");

    const again = await subscribe(
      account.orgId,
      listId,
      { address: "ada@example.com" },
      "signup form",
    );
    assert.equal(again.status, "resubscribed");

    const [after_] = await membersView(account.orgId, listId);
    assert.equal(after_?.status, "subscribed");
  });

  it("refuses to resubscribe an address that bounced", async () => {
    const { db } = await import("@/db");
    const { listMember } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { membersView, subscribe } = await import("@/server/campaigns");

    // A broken address or somebody who reported us is not undone by a form
    // submission: writing there again costs everybody else's deliverability.
    const listId = await aList();
    await subscribe(account.orgId, listId, { address: "ada@example.com" }, "signup form");
    const [row] = await membersView(account.orgId, listId);
    assert.ok(row);
    await db.update(listMember).set({ status: "bounced" }).where(eq(listMember.id, row.id));

    const again = await subscribe(
      account.orgId,
      listId,
      { address: "ada@example.com" },
      "signup form",
    );
    assert.equal(again.status, "blocked");
  });

  it("refuses an address that is not one", async () => {
    const { subscribe } = await import("@/server/campaigns");
    const listId = await aList();
    await assert.rejects(
      () => subscribe(account.orgId, listId, { address: "nope" }, "signup form"),
      /not an email/,
    );
  });
});

describe("a broadcast written in the builder", () => {
  it("compiles its blocks into the body it will send", async () => {
    const { createBroadcast, updateBroadcast, findBroadcast } = await import("@/server/campaigns");
    const { emptyDesign, newBlock } = await import("@/lib/email-blocks");

    const id = await createBroadcast(account.orgId, {
      listId: await aList(),
      mailboxId: account.mailboxId,
      subject: "Hello",
    });

    const design = {
      ...emptyDesign(),
      blocks: [{ ...newBlock("heading", "b1"), text: "Shipped" }],
    };
    await updateBroadcast(account.orgId, id, { design: design as never });

    const row = await findBroadcast(account.orgId, id);
    // The blocks are kept, and the body is derived from them — the same rule
    // a template follows, so the two cannot disagree about what was written.
    assert.ok(row?.html?.includes("Shipped"));
    assert.equal(row?.text, "Shipped");
    assert.equal((row?.design as { blocks: unknown[] }).blocks.length, 1);
  });

  it("refuses to be edited once it has started", async () => {
    const { createBroadcast, updateBroadcast, startBroadcast } = await import("@/server/campaigns");

    const { addMembers } = await import("@/server/campaigns");
    const listId = await aList();
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "signup form");

    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Going out",
    });
    await startBroadcast(account.orgId, id, null);

    // What went out is what went out. A record that can be edited afterwards
    // is not a record.
    await assert.rejects(() => updateBroadcast(account.orgId, id, { subject: "Changed" }));
  });
});

describe("aiming a campaign at part of a list", () => {
  it("counts only the people a segment matches", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { createSegment, findSegment, segmentSize } = await import("@/server/segments");

    const listId = await aList();
    await addMembers(
      account.orgId,
      listId,
      [
        { address: "ada@example.com", fields: { plan: "pro" } },
        { address: "bob@example.com", fields: { plan: "free" } },
        { address: "cyd@example.com", fields: { plan: "pro" } },
      ],
      "import",
    );

    const id = await createSegment(account.orgId, {
      listId,
      name: "Paying",
      rules: [{ field: "fields.plan", op: "is", value: "pro" }],
    });

    const row = await findSegment(account.orgId, id);
    assert.ok(row);
    assert.equal(await segmentSize(account.orgId, row), 2);
  });

  it("counts somebody with no value as not matching the value", async () => {
    const { addMembers } = await import("@/server/campaigns");
    const { createSegment, findSegment, segmentSize } = await import("@/server/segments");

    const listId = await aList();
    await addMembers(
      account.orgId,
      listId,
      [{ address: "ada@example.com", fields: { plan: "free" } }, { address: "bob@example.com" }],
      "import",
    );

    // "plan is not free" has to include the person with no plan recorded.
    // Leaving them out is the bug that makes a segment quietly too small.
    const id = await createSegment(account.orgId, {
      listId,
      name: "Not free",
      rules: [{ field: "fields.plan", op: "is_not", value: "free" }],
    });

    const row = await findSegment(account.orgId, id);
    assert.ok(row);
    assert.equal(await segmentSize(account.orgId, row), 1);
  });

  it("sends only to the segment", async () => {
    const { addMembers, createBroadcast, startBroadcast } = await import("@/server/campaigns");
    const { createSegment } = await import("@/server/segments");

    const listId = await aList();
    await addMembers(
      account.orgId,
      listId,
      [
        { address: "ada@example.com", fields: { city: "London" } },
        { address: "bob@example.com", fields: { city: "Berlin" } },
      ],
      "import",
    );

    const segmentId = await createSegment(account.orgId, {
      listId,
      name: "London",
      rules: [{ field: "fields.city", op: "is", value: "London" }],
    });

    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Hello London",
      segmentId,
    });

    const result = await startBroadcast(account.orgId, id, null);
    assert.equal(result.recipients, 1);
  });

  it("refuses a segment that belongs to another list", async () => {
    const { createBroadcast } = await import("@/server/campaigns");
    const { createSegment } = await import("@/server/segments");

    const one = await aList("One");
    const two = await aList("Two");
    const segmentId = await createSegment(account.orgId, { listId: two, name: "Elsewhere" });

    // Otherwise it sends to nobody, silently, and looks like a bug in the send.
    await assert.rejects(() =>
      createBroadcast(account.orgId, {
        listId: one,
        mailboxId: account.mailboxId,
        subject: "Wrong",
        segmentId,
      }),
    );
  });

  it("drops the segment when the list is changed underneath it", async () => {
    const { createBroadcast, findBroadcast, updateBroadcast } = await import("@/server/campaigns");
    const { createSegment } = await import("@/server/segments");

    const one = await aList("One");
    const two = await aList("Two");
    const segmentId = await createSegment(account.orgId, { listId: one, name: "Here" });

    const id = await createBroadcast(account.orgId, {
      listId: one,
      mailboxId: account.mailboxId,
      subject: "Moving",
      segmentId,
    });

    await updateBroadcast(account.orgId, id, { listId: two });
    const row = await findBroadcast(account.orgId, id);
    assert.equal(row?.listId, two);
    assert.equal(row?.segmentId, null);
  });
});

describe("testing two subject lines", () => {
  it("splits the audience in half and remembers which half each person was in", async () => {
    const { addMembers, createBroadcast, startBroadcast, updateBroadcast } = await import(
      "@/server/campaigns"
    );
    const { db } = await import("@/db");
    const { broadcastRecipient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const listId = await aList();
    await addMembers(
      account.orgId,
      listId,
      Array.from({ length: 40 }, (_, at) => ({ address: `person${at}@example.com` })),
      "import",
    );

    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "One way of saying it",
    });
    await updateBroadcast(account.orgId, id, { subjectB: "Another way" });
    await startBroadcast(account.orgId, id, null);

    const rows = await db
      .select({ variant: broadcastRecipient.variant })
      .from(broadcastRecipient)
      .where(eq(broadcastRecipient.broadcastId, id));

    const b = rows.filter((row) => row.variant === "b").length;
    // A hash, not a coin toss: forty people will not split exactly, but a
    // split that lands outside a quarter either way is not a split.
    assert.ok(b > 10 && b < 30, `expected a rough half, got ${b} of 40`);
  });

  it("puts everybody in one half when there is nothing to test", async () => {
    const { addMembers, createBroadcast, startBroadcast } = await import("@/server/campaigns");
    const { db } = await import("@/db");
    const { broadcastRecipient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const listId = await aList();
    await addMembers(
      account.orgId,
      listId,
      [{ address: "ada@example.com" }, { address: "bob@example.com" }],
      "import",
    );

    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Only one",
    });
    await startBroadcast(account.orgId, id, null);

    const rows = await db
      .select({ variant: broadcastRecipient.variant })
      .from(broadcastRecipient)
      .where(eq(broadcastRecipient.broadcastId, id));
    assert.ok(rows.every((row) => row.variant === "a"));
  });
});

describe("sending it again to the people who never opened it", () => {
  it("takes its audience from the first send, not the list", async () => {
    const { addMembers, createBroadcast, resendToNonOpeners, startBroadcast } = await import(
      "@/server/campaigns"
    );
    const { db } = await import("@/db");
    const { broadcast, broadcastRecipient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const listId = await aList();
    await addMembers(
      account.orgId,
      listId,
      [{ address: "ada@example.com" }, { address: "bob@example.com" }],
      "import",
    );

    const first = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Round one",
    });
    await startBroadcast(account.orgId, first, null);

    // Pretend the send finished and one of them opened it.
    const rows = await db
      .select({ id: broadcastRecipient.id })
      .from(broadcastRecipient)
      .where(eq(broadcastRecipient.broadcastId, first));
    await db
      .update(broadcastRecipient)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(broadcastRecipient.broadcastId, first));
    await db
      .update(broadcastRecipient)
      .set({ openedAt: new Date() })
      .where(eq(broadcastRecipient.id, rows[0]!.id));
    await db.update(broadcast).set({ status: "sent" }).where(eq(broadcast.id, first));

    // Somebody who joined after the first send was never given it, so a
    // reminder about it would be a reminder about nothing.
    await addMembers(account.orgId, listId, [{ address: "new@example.com" }], "import");

    const again = await resendToNonOpeners(account.orgId, first);
    assert.equal(again.audience, 1);

    const started = await startBroadcast(account.orgId, again.id, null);
    assert.equal(started.recipients, 1);
  });

  it("refuses when everybody opened it", async () => {
    const { addMembers, createBroadcast, resendToNonOpeners, startBroadcast } = await import(
      "@/server/campaigns"
    );
    const { db } = await import("@/db");
    const { broadcast, broadcastRecipient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const listId = await aList();
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "import");

    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Everybody read it",
    });
    await startBroadcast(account.orgId, id, null);
    await db
      .update(broadcastRecipient)
      .set({ status: "sent", sentAt: new Date(), openedAt: new Date() })
      .where(eq(broadcastRecipient.broadcastId, id));
    await db.update(broadcast).set({ status: "sent" }).where(eq(broadcast.id, id));

    await assert.rejects(() => resendToNonOpeners(account.orgId, id));
  });
});

describe("copying a campaign", () => {
  it("copies the message and none of the send", async () => {
    const { addMembers, createBroadcast, duplicateBroadcast, findBroadcast, startBroadcast } =
      await import("@/server/campaigns");

    const listId = await aList();
    await addMembers(account.orgId, listId, [{ address: "ada@example.com" }], "import");

    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Worth repeating",
      html: "<p>Hello</p>",
    });
    await startBroadcast(account.orgId, id, null);

    const made = await duplicateBroadcast(account.orgId, id);
    const copy = await findBroadcast(account.orgId, made);

    assert.equal(copy?.html, "<p>Hello</p>");
    assert.equal(copy?.subject, "Worth repeating (copy)");
    // A copy that kept its schedule or its numbers would be a lie about
    // something that never went out.
    assert.equal(copy?.status, "draft");
    assert.equal(copy?.startedAt, null);
  });
});

describe("making people confirm before they count", () => {
  it("leaves a new signup pending on a double opt-in list", async () => {
    const { membersView, subscribe, updateList } = await import("@/server/campaigns");

    const listId = await aList();
    await updateList(account.orgId, listId, { doubleOptIn: true });

    const result = await subscribe(
      account.orgId,
      listId,
      { address: "ada@example.com" },
      "signup form",
    );
    assert.equal(result.status, "pending");

    const [row] = await membersView(account.orgId, listId);
    assert.equal(row?.status, "pending");
  });

  it("leaves a pending person out of a send", async () => {
    const { createBroadcast, startBroadcast, subscribe, updateList } = await import(
      "@/server/campaigns"
    );

    const listId = await aList();
    await updateList(account.orgId, listId, { doubleOptIn: true });
    await subscribe(account.orgId, listId, { address: "ada@example.com" }, "signup form");

    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Not for them yet",
    });

    // Nobody confirmed, so there is nobody to send to — and being told that
    // is better than the send going out to one unconfirmed address.
    await assert.rejects(() => startBroadcast(account.orgId, id, null));
  });

  it("subscribes them when the link is clicked, and says so once", async () => {
    const { confirmByToken, confirmToken, membersView, subscribe, updateList } = await import(
      "@/server/campaigns"
    );

    const listId = await aList();
    await updateList(account.orgId, listId, { doubleOptIn: true });
    const made = await subscribe(
      account.orgId,
      listId,
      { address: "ada@example.com" },
      "signup form",
    );

    const first = await confirmByToken(confirmToken(made.id));
    assert.equal(first?.fresh, true);

    const [row] = await membersView(account.orgId, listId);
    assert.equal(row?.status, "subscribed");

    // A link scanner follows every URL in a message before the reader sees
    // it, so the second visit is usually not even a person.
    const again = await confirmByToken(confirmToken(made.id));
    assert.equal(again?.fresh, false);
    assert.equal((await membersView(account.orgId, listId))[0]?.status, "subscribed");
  });

  it("refuses an unsubscribe token as a confirmation", async () => {
    const { confirmByToken, subscribe, unsubscribeToken, updateList } = await import(
      "@/server/campaigns"
    );

    const listId = await aList();
    await updateList(account.orgId, listId, { doubleOptIn: true });
    const made = await subscribe(
      account.orgId,
      listId,
      { address: "ada@example.com" },
      "signup form",
    );

    // Two signatures over different strings, so one cannot stand in for the
    // other — a confirmation link that unsubscribed would be found late.
    assert.equal(await confirmByToken(unsubscribeToken(made.id)), null);
  });

  it("subscribes straight away when the list does not ask", async () => {
    const { membersView, subscribe } = await import("@/server/campaigns");

    const listId = await aList();
    const result = await subscribe(
      account.orgId,
      listId,
      { address: "ada@example.com" },
      "signup form",
    );
    assert.equal(result.status, "subscribed");
    assert.equal((await membersView(account.orgId, listId))[0]?.status, "subscribed");
  });
});

describe("what a campaign did", () => {
  it("counts opens, clicks and the people it lost", async () => {
    const {
      addMembers,
      broadcastReport,
      createBroadcast,
      startBroadcast,
      unsubscribeByToken,
      unsubscribeToken,
    } = await import("@/server/campaigns");
    const { db } = await import("@/db");
    const { broadcastClick, broadcastRecipient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { newId } = await import("@/lib/utils");

    const listId = await aList();
    await addMembers(
      account.orgId,
      listId,
      [
        { address: "ada@example.com" },
        { address: "bob@example.com" },
        { address: "cyd@example.com" },
      ],
      "import",
    );

    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Measured",
    });
    await startBroadcast(account.orgId, id, null);

    await db
      .update(broadcastRecipient)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(broadcastRecipient.broadcastId, id));

    const rows = await db
      .select({ id: broadcastRecipient.id, memberId: broadcastRecipient.listMemberId })
      .from(broadcastRecipient)
      .where(eq(broadcastRecipient.broadcastId, id));

    await db
      .update(broadcastRecipient)
      .set({ openedAt: new Date() })
      .where(eq(broadcastRecipient.id, rows[0]!.id));
    await db
      .update(broadcastRecipient)
      .set({ openedAt: new Date(), clickedAt: new Date() })
      .where(eq(broadcastRecipient.id, rows[1]!.id));
    await db.insert(broadcastClick).values({
      id: newId("bcc"),
      organizationId: account.orgId,
      broadcastId: id,
      recipientId: rows[1]!.id,
      url: "https://example.test/post",
      clicks: 3,
    });

    await unsubscribeByToken(unsubscribeToken(rows[2]!.memberId));

    const report = await broadcastReport(account.orgId, id);
    assert.ok(report);
    assert.equal(report.sent, 3);
    assert.equal(report.opened, 2);
    assert.equal(report.clicked, 1);
    assert.equal(report.unsubscribed, 1);
    // People, not clicks: a newsletter forwarded round an office would
    // otherwise turn one reader into a crowd.
    assert.equal(report.links[0]?.people, 1);
    assert.equal(report.links[0]?.clicks, 3);
  });
});
