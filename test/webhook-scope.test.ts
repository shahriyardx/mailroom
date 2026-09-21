import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

let scratch: Scratch;
let account: Seeded;

/** Every URL the dispatcher tried, so a test can say who heard about what. */
let hit: string[] = [];
const realFetch = globalThis.fetch;

before(async () => {
  scratch = makeScratchDatabase("whscope");
  account = await seedAccount();

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    hit.push(typeof input === "string" ? input : input.toString());
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  hit = [];
  const { db } = await import("@/db");
  const { webhook, webhookDelivery } = await import("@/db/schema");
  await db.delete(webhookDelivery);
  await db.delete(webhook);
});

/** Deliveries are fired and not awaited, so give them a turn to land. */
async function settle() {
  for (let i = 0; i < 20 && hit.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function addHook(
  url: string,
  scope: { mailboxId?: string | null; domainId?: string | null } = {},
) {
  const { db } = await import("@/db");
  const { webhook } = await import("@/db/schema");
  const { newId } = await import("@/lib/utils");
  const id = newId("whk");
  await db.insert(webhook).values({
    id,
    organizationId: account.orgId,
    url,
    events: ["*"],
    secret: "whsec_test_secret_value",
    mailboxId: scope.mailboxId ?? null,
    domainId: scope.domainId ?? null,
  });
  return id;
}

/** Made once and reused: only webhooks are cleared between tests. */
let second: { domainId: string; mailboxId: string } | null = null;

async function otherDomain() {
  if (second) return second;
  const { db } = await import("@/db");
  const { domain, mailbox } = await import("@/db/schema");
  const { newId } = await import("@/lib/utils");
  const domainId = newId("dom");
  const mailboxId = newId("mbx");
  await db.insert(domain).values({
    id: domainId,
    organizationId: account.orgId,
    name: "other.test",
    region: "us-east-1",
    status: "verified",
    sendingEnabled: true,
  });
  await db.insert(mailbox).values({
    id: mailboxId,
    organizationId: account.orgId,
    domainId,
    address: "sender@other.test",
    domain: "other.test",
    displayName: "Other",
  });
  second = { domainId, mailboxId };
  return second;
}

/* -------------------------------------------------------------------------- */

describe("what a webhook hears about", () => {
  it("an unscoped endpoint hears everything", async () => {
    const { dispatchWebhooks } = await import("@/server/webhooks");
    await addHook("https://hooks.test/all");

    await dispatchWebhooks(account.orgId, "mail.received", {}, { mailboxId: account.mailboxId });
    await settle();

    assert.deepEqual(hit, ["https://hooks.test/all"]);
  });

  it("a domain endpoint hears about a mailbox on that domain", async () => {
    const { dispatchWebhooks } = await import("@/server/webhooks");
    await addHook("https://hooks.test/domain", { domainId: account.domainId });

    await dispatchWebhooks(account.orgId, "mail.received", {}, { mailboxId: account.mailboxId });
    await settle();

    assert.deepEqual(hit, ["https://hooks.test/domain"]);
  });

  it("a domain endpoint hears nothing about another domain", async () => {
    const { dispatchWebhooks } = await import("@/server/webhooks");
    const other = await otherDomain();
    await addHook("https://hooks.test/domain", { domainId: account.domainId });

    await dispatchWebhooks(account.orgId, "mail.received", {}, { mailboxId: other.mailboxId });
    await settle();

    assert.deepEqual(hit, []);
  });

  it("a domain endpoint covers a mailbox added to that domain later", async () => {
    const { db } = await import("@/db");
    const { mailbox } = await import("@/db/schema");
    const { newId } = await import("@/lib/utils");
    const { dispatchWebhooks } = await import("@/server/webhooks");

    await addHook("https://hooks.test/domain", { domainId: account.domainId });

    // The point of scoping to a domain rather than a mailbox: this address
    // did not exist when the endpoint was made.
    const laterId = newId("mbx");
    await db.insert(mailbox).values({
      id: laterId,
      organizationId: account.orgId,
      domainId: account.domainId,
      address: "later@example.test",
      domain: "example.test",
      displayName: "Later",
    });

    await dispatchWebhooks(account.orgId, "mail.received", {}, { mailboxId: laterId });
    await settle();

    assert.deepEqual(hit, ["https://hooks.test/domain"]);
  });

  it("a mailbox endpoint still hears only its own mailbox", async () => {
    const { dispatchWebhooks } = await import("@/server/webhooks");
    const other = await otherDomain();
    await addHook("https://hooks.test/mailbox", { mailboxId: account.mailboxId });

    await dispatchWebhooks(account.orgId, "mail.received", {}, { mailboxId: other.mailboxId });
    await settle();
    assert.deepEqual(hit, []);

    await dispatchWebhooks(account.orgId, "mail.received", {}, { mailboxId: account.mailboxId });
    await settle();
    assert.deepEqual(hit, ["https://hooks.test/mailbox"]);
  });

  it("a scoped endpoint is skipped by an event with no mailbox to place it", async () => {
    const { dispatchWebhooks } = await import("@/server/webhooks");
    await addHook("https://hooks.test/domain", { domainId: account.domainId });
    await addHook("https://hooks.test/all");

    await dispatchWebhooks(account.orgId, "mail.received", {}, {});
    await settle();

    assert.deepEqual(hit, ["https://hooks.test/all"]);
  });
});
