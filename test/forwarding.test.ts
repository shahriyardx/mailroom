import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { newId } from "@/lib/utils";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * Where a copy of inbound mail goes.
 *
 * The worker asks this question for every message and forwards to whatever
 * comes back, so a wrong answer here is somebody else's mail arriving in a
 * stranger's inbox. Two things are load-bearing and neither is obvious from
 * reading the rules table: an address nobody has verified must never be
 * returned, and `forwardOff` has to stop the wider widths without touching
 * the narrow one it is set on.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("forwarding");
  account = await seedAccount();
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { domain, forwardAddress, forwardRule, mailbox } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  await db.delete(forwardRule);
  await db.delete(forwardAddress);
  await db.update(domain).set({ forwardOff: false }).where(eq(domain.id, account.domainId));
  await db.update(mailbox).set({ forwardOff: false }).where(eq(mailbox.id, account.mailboxId));
});

/** An address on the list, verified unless told otherwise. */
async function address(email: string, verified = true) {
  const { db } = await import("@/db");
  const { forwardAddress } = await import("@/db/schema");

  const id = newId("fwa");
  await db.insert(forwardAddress).values({
    id,
    organizationId: account.orgId,
    address: email,
    destinationId: `dst_${id}`,
    verifiedAt: verified ? new Date() : null,
  });
  return id;
}

async function rule(
  addressId: string,
  width: { domainId?: string; mailboxId?: string } = {},
) {
  const { db } = await import("@/db");
  const { forwardRule } = await import("@/db/schema");

  await db.insert(forwardRule).values({
    id: newId("fwr"),
    organizationId: account.orgId,
    addressId,
    domainId: width.domainId ?? null,
    mailboxId: width.mailboxId ?? null,
  });
}

async function off(what: "domain" | "mailbox") {
  const { db } = await import("@/db");
  const { domain, mailbox } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  if (what === "domain") {
    await db.update(domain).set({ forwardOff: true }).where(eq(domain.id, account.domainId));
    return;
  }
  await db.update(mailbox).set({ forwardOff: true }).where(eq(mailbox.id, account.mailboxId));
}

describe("where a mailbox's mail is copied", () => {
  it("forwards nowhere when nothing is set up", async () => {
    const { targetsForMailbox } = await import("@/server/forwarding");
    assert.deepEqual(await targetsForMailbox(account.orgId, account.mailboxId), []);
  });

  it("uses a rule written for the whole instance", async () => {
    const { targetsForMailbox } = await import("@/server/forwarding");
    await rule(await address("archive@example.com"));

    assert.deepEqual(await targetsForMailbox(account.orgId, account.mailboxId), [
      "archive@example.com",
    ]);
  });

  it("adds up every width that matches", async () => {
    const { targetsForMailbox } = await import("@/server/forwarding");
    await rule(await address("everything@example.com"));
    await rule(await address("domain@example.com"), { domainId: account.domainId });
    await rule(await address("box@example.com"), { mailboxId: account.mailboxId });

    const targets = await targetsForMailbox(account.orgId, account.mailboxId);
    assert.deepEqual(targets.sort(), [
      "box@example.com",
      "domain@example.com",
      "everything@example.com",
    ]);
  });

  it("never returns an address nobody has verified", async () => {
    const { targetsForMailbox } = await import("@/server/forwarding");
    // Cloudflare rejects a forward to an unverified destination, and a
    // rejected forward fails the whole message. Half-finished setup must
    // mean no copy, not lost mail.
    await rule(await address("waiting@example.com", false));

    assert.deepEqual(await targetsForMailbox(account.orgId, account.mailboxId), []);
  });

  it("keeps a mailbox that opted out clear of the wider rules", async () => {
    const { targetsForMailbox } = await import("@/server/forwarding");
    await rule(await address("everything@example.com"));
    await rule(await address("domain@example.com"), { domainId: account.domainId });
    await off("mailbox");

    assert.deepEqual(await targetsForMailbox(account.orgId, account.mailboxId), []);
  });

  it("still honours a mailbox's own rule when it has opted out", async () => {
    const { targetsForMailbox } = await import("@/server/forwarding");
    await rule(await address("everything@example.com"));
    await rule(await address("box@example.com"), { mailboxId: account.mailboxId });
    await off("mailbox");

    assert.deepEqual(await targetsForMailbox(account.orgId, account.mailboxId), [
      "box@example.com",
    ]);
  });

  it("keeps a domain that opted out clear of the instance rule", async () => {
    const { targetsForMailbox } = await import("@/server/forwarding");
    await rule(await address("everything@example.com"));
    await rule(await address("domain@example.com"), { domainId: account.domainId });
    await off("domain");

    assert.deepEqual(await targetsForMailbox(account.orgId, account.mailboxId), [
      "domain@example.com",
    ]);
  });

  it("says nothing about a mailbox in another account", async () => {
    const { targetsForMailbox } = await import("@/server/forwarding");
    await rule(await address("everything@example.com"));

    assert.deepEqual(await targetsForMailbox(newId("org"), account.mailboxId), []);
  });
});

describe("where mail for an address nobody owns is copied", () => {
  it("falls back to the domain and instance rules", async () => {
    const { targetsForUnknownAddress } = await import("@/server/forwarding");
    await rule(await address("everything@example.com"));
    await rule(await address("domain@example.com"), { domainId: account.domainId });

    const targets = await targetsForUnknownAddress("retired@example.test");
    assert.deepEqual(targets.sort(), ["domain@example.com", "everything@example.com"]);
  });

  it("ignores a mailbox rule, which cannot apply to an address with no mailbox", async () => {
    const { targetsForUnknownAddress } = await import("@/server/forwarding");
    await rule(await address("box@example.com"), { mailboxId: account.mailboxId });

    assert.deepEqual(await targetsForUnknownAddress("retired@example.test"), []);
  });

  it("forwards nowhere for a domain this instance has never heard of", async () => {
    const { targetsForUnknownAddress } = await import("@/server/forwarding");
    await rule(await address("everything@example.com"));

    assert.deepEqual(await targetsForUnknownAddress("someone@stranger.test"), []);
  });
});
