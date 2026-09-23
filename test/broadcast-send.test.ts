import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { sesCalls, sesReset } from "./fakes/ses";
import { type Scratch, type Seeded, makeScratchDatabase, seedAccount } from "./helpers/db";

/**
 * A campaign, all the way out, with SES faked at the last inch.
 *
 * Everything else about campaigns is tested a layer down — who is on the
 * list, what a segment matches, whether a rate is counted. This is the only
 * place the whole thing runs: the audience is frozen, the body is compiled
 * from blocks, the placeholders are filled in for one person, the footer is
 * added, and what comes out is inspected as the bytes that would have gone
 * to Amazon.
 *
 * It exists because none of that can be checked afterwards. An email that
 * arrives with `{{plan}}` in the subject has already arrived.
 */

let scratch: Scratch;
let account: Seeded;

before(async () => {
  scratch = makeScratchDatabase("broadcast-send");
  account = await seedAccount();
  process.env.BETTER_AUTH_SECRET ??= "test-secret-for-broadcast-send";
});

after(async () => {
  const { rawSql } = await import("@/db");
  await rawSql().end({ timeout: 1 });
  scratch.drop();
});

beforeEach(async () => {
  sesReset();
  const { db } = await import("@/db");
  const { broadcast, broadcastRecipient, listMember, mailingList, message, messageEvent, sendJob } =
    await import("@/db/schema");
  await db.delete(sendJob);
  await db.delete(messageEvent);
  await db.delete(broadcastRecipient);
  await db.delete(broadcast);
  await db.delete(message);
  await db.delete(listMember);
  await db.delete(mailingList);
});

/**
 * What the fake was handed, as readable text.
 *
 * The headers, then every part of the message with its transfer encoding
 * undone. Without this an assertion is really about base64, which is a thing
 * no test should be about: the HTML part of a real send is base64 and the
 * text part usually is not, and neither of those is a decision this codebase
 * makes — the mail library does.
 */
function bodyOf(at = 0) {
  const call = sesCalls[at];
  assert.ok(call, "nothing was handed to SES");
  const raw = Buffer.from(call.raw).toString("utf8");

  const boundary = /boundary="([^"]+)"/.exec(raw)?.[1];
  if (!boundary) return raw;

  const [headers, ...parts] = raw.split(`--${boundary}`);
  const decoded = parts.map((part) => {
    const split = part.indexOf("\r\n\r\n");
    if (split === -1) return part;

    const head = part.slice(0, split);
    const payload = part.slice(split + 4);

    if (/content-transfer-encoding:\s*base64/i.test(head)) {
      return `${head}\n${Buffer.from(payload.replace(/\s+/g, ""), "base64").toString("utf8")}`;
    }
    if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) {
      return `${head}\n${payload
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))}`;
    }
    return `${head}\n${payload}`;
  });

  return [headers, ...decoded].join("\n");
}

/**
 * Only the HTML half of the message.
 *
 * The text half of the same send carries the same values unescaped, and it is
 * right that it does — a text part is not markup. An assertion about escaping
 * has to say which half it means.
 */
function htmlPartOf(at = 0) {
  const body = bodyOf(at);
  const start = body.indexOf("text/html");
  assert.notEqual(start, -1, "there is no HTML part");
  return body.slice(start);
}

/** One person, on one list, carrying a merge field. */
async function anAudience(fields: Record<string, string> = { plan: "Pro", city: "London" }) {
  const { addMembers, createList } = await import("@/server/campaigns");
  const listId = await createList(account.orgId, "Newsletter");
  await addMembers(
    account.orgId,
    listId,
    [{ address: "ada@example.com", name: "Ada", fields }],
    "signup form",
  );
  return listId;
}

/** A campaign written, started, and carried all the way to the fake. */
async function sendIt(input: { subject: string; html?: string; design?: unknown }) {
  const { createBroadcast, startBroadcast, updateBroadcast } = await import("@/server/campaigns");
  const { runBroadcastsOnce } = await import("@/server/broadcast-runner");

  const listId = await anAudience();
  const id = await createBroadcast(account.orgId, {
    listId,
    mailboxId: account.mailboxId,
    subject: input.subject,
  });
  await updateBroadcast(account.orgId, id, {
    subject: input.subject,
    html: input.html ?? null,
    design: (input.design ?? null) as never,
  });
  await startBroadcast(account.orgId, id);

  const run = await runBroadcastsOnce();
  return { id, listId, run };
}

describe("a campaign, all the way out", () => {
  it("hands exactly one message to SES and marks it sent", async () => {
    const { run } = await sendIt({ subject: "Hello", html: "<p>Hi</p>" });

    assert.equal(run.sent, 1);
    assert.equal(run.failed, 0);
    assert.equal(sesCalls.length, 1);
    assert.deepEqual(sesCalls[0]?.to, ["ada@example.com"]);
  });

  it("fills in the name and every other field, in the subject and the body", async () => {
    await sendIt({
      subject: "Your {{plan}} plan, {{name}}",
      html: "<p>Hello {{name}} in {{city}} on {{plan}}.</p>",
    });

    const body = bodyOf();
    assert.ok(body.includes("Your Pro plan, Ada"), "the subject was not filled in");
    assert.ok(body.includes("Hello Ada in London on Pro."), "the body was not filled in");
    // The one outcome that cannot be explained away afterwards.
    assert.ok(!body.includes("{{"), "a placeholder reached the message");
  });

  it('says "there" rather than an address when there is no name', async () => {
    const { addMembers, createBroadcast, createList, startBroadcast, updateBroadcast } =
      await import("@/server/campaigns");
    const { runBroadcastsOnce } = await import("@/server/broadcast-runner");

    const listId = await createList(account.orgId, "Newsletter");
    await addMembers(account.orgId, listId, [{ address: "nameless@example.com" }], "import");
    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Hi",
    });
    await updateBroadcast(account.orgId, id, { html: "<p>Hello {{name}}.</p>" });
    await startBroadcast(account.orgId, id);
    await runBroadcastsOnce();

    const body = bodyOf();
    assert.ok(body.includes("Hello there."));
    assert.ok(!body.includes("nameless@example.com</p>"));
  });

  it("uses the fallback after the pipe for a field nobody has", async () => {
    await sendIt({ subject: "Hi", html: "<p>On the {{tier|free}} tier.</p>" });
    assert.ok(bodyOf().includes("On the free tier."));
  });

  it("escapes a field value on its way into the HTML", async () => {
    const { addMembers, createBroadcast, createList, startBroadcast, updateBroadcast } =
      await import("@/server/campaigns");
    const { runBroadcastsOnce } = await import("@/server/broadcast-runner");

    const listId = await createList(account.orgId, "Newsletter");
    await addMembers(
      account.orgId,
      listId,
      [{ address: "ada@example.com", name: "Ada", fields: { city: "<script>x</script>" } }],
      "import",
    );
    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Hi",
    });
    await updateBroadcast(account.orgId, id, { html: "<p>{{city}}</p>" });
    await startBroadcast(account.orgId, id);
    await runBroadcastsOnce();

    const html = htmlPartOf();
    assert.ok(!html.includes("<script>x</script>"), "a tag from a field survived into the markup");
    assert.ok(html.includes("&lt;script&gt;"));

    // The text part is not markup, so it carries the value as written. Said
    // here so that a later reader does not "fix" it.
    assert.ok(bodyOf().includes("<script>x</script>"));
  });

  it("carries a working web copy link where it was asked for", async () => {
    const { archiveToken } = await import("@/server/campaigns");
    const { id } = await sendIt({
      subject: "Hi",
      html: '<p><a href="{{view_in_browser}}">Read it online</a></p>',
    });

    assert.ok(bodyOf().includes(archiveToken(id)), "the archive link was not filled in");
  });

  it("carries a preferences link that points at this person", async () => {
    const { membersView, preferencesToken } = await import("@/server/campaigns");
    const { listId } = await sendIt({
      subject: "Hi",
      html: '<p><a href="{{preferences}}">Choose what you get</a></p>',
    });

    const [row] = await membersView(account.orgId, listId);
    assert.ok(row);
    assert.ok(bodyOf().includes(preferencesToken(row.id)));
  });

  it("adds an unsubscribe link and the headers Gmail insists on", async () => {
    await sendIt({ subject: "Hi", html: "<p>No footer written by hand.</p>" });

    const body = bodyOf();
    assert.ok(body.includes("List-Unsubscribe:"), "the header is missing");
    assert.ok(body.includes("List-Unsubscribe-Post: List-Unsubscribe=One-Click"));
    assert.ok(body.includes("/unsubscribe/"), "no way out was added to the body");
  });

  it("compiles the new blocks into the message rather than into nothing", async () => {
    const { emptyDesign, newBlock } = await import("@/lib/email-blocks");
    const design = {
      ...emptyDesign(),
      blocks: [
        { ...newBlock("list", "b1"), items: ["Ada did a thing", "Then another"] },
        { ...newBlock("callout", "b2"), html: "Mind this one" },
        {
          ...newBlock("stat", "b3"),
          items: [{ value: "1,204", label: "Subscribers" }],
        },
        {
          ...newBlock("menu", "b4"),
          links: [{ label: "Home", href: "https://example.test" }],
        },
      ],
    };

    await sendIt({ subject: "Hi", design });

    const body = bodyOf();
    assert.ok(body.includes("Ada did a thing"), "the list did not compile");
    assert.ok(body.includes("Mind this one"), "the callout did not compile");
    assert.ok(body.includes("1,204"), "the numbers did not compile");
    assert.ok(body.includes("Home"), "the menu did not compile");
  });

  it("sends a text part as well, because a message without one reads as spam", async () => {
    const { emptyDesign, newBlock } = await import("@/lib/email-blocks");
    const design = {
      ...emptyDesign(),
      blocks: [{ ...newBlock("list", "b1"), items: ["The only item"], ordered: true }],
    };

    await sendIt({ subject: "Hi", design });

    const body = bodyOf();
    assert.ok(body.includes("text/plain"), "there is no text part");
    assert.ok(body.includes("1. The only item"), "the text part lost the list");
  });

  it("stops at the hourly ceiling and leaves the rest pending", async () => {
    const { addMembers, createBroadcast, createList, startBroadcast } = await import(
      "@/server/campaigns"
    );
    const { saveWorkspaceSettings } = await import("@/server/workspace");
    const { runBroadcastsOnce } = await import("@/server/broadcast-runner");
    const { db } = await import("@/db");
    const { broadcastRecipient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    await saveWorkspaceSettings(account.orgId, { sendRatePerHour: 2 });

    const listId = await createList(account.orgId, "Newsletter");
    await addMembers(
      account.orgId,
      listId,
      ["a", "b", "c", "d"].map((letter) => ({ address: `${letter}@example.com` })),
      "import",
    );
    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Hi",
    });
    await startBroadcast(account.orgId, id);

    const first = await runBroadcastsOnce();
    assert.equal(first.sent, 2, "the ceiling was not respected");

    // Nothing is dropped: the rest is still waiting for the window to roll.
    const pending = await db
      .select({ id: broadcastRecipient.id })
      .from(broadcastRecipient)
      .where(eq(broadcastRecipient.status, "pending"));
    assert.equal(pending.length, 2);

    // And the campaign is still sending rather than wrongly marked finished.
    const second = await runBroadcastsOnce();
    assert.equal(second.sent, 0, "it sent past the ceiling on the next pass");

    await saveWorkspaceSettings(account.orgId, { sendRatePerHour: null });
  });

  it("does not write to somebody who left between freezing and sending", async () => {
    const {
      addMembers,
      createBroadcast,
      createList,
      membersView,
      setMemberStatus,
      startBroadcast,
    } = await import("@/server/campaigns");
    const { runBroadcastsOnce } = await import("@/server/broadcast-runner");

    const listId = await createList(account.orgId, "Newsletter");
    await addMembers(
      account.orgId,
      listId,
      [{ address: "ada@example.com" }, { address: "bob@example.com" }],
      "import",
    );
    const id = await createBroadcast(account.orgId, {
      listId,
      mailboxId: account.mailboxId,
      subject: "Hi",
    });
    await startBroadcast(account.orgId, id);

    const rows = await membersView(account.orgId, listId);
    const bob = rows.find((row) => row.address === "bob@example.com");
    assert.ok(bob);
    await setMemberStatus(account.orgId, bob.id, "unsubscribed");

    const run = await runBroadcastsOnce();
    assert.equal(run.sent, 1);
    assert.deepEqual(
      sesCalls.map((call) => call.to[0]),
      ["ada@example.com"],
    );
  });

  it("finishes the campaign once everybody has been written to", async () => {
    const { findBroadcast } = await import("@/server/campaigns");
    const { runBroadcastsOnce } = await import("@/server/broadcast-runner");

    const { id } = await sendIt({ subject: "Hi", html: "<p>Hi</p>" });
    await runBroadcastsOnce();

    assert.equal((await findBroadcast(account.orgId, id))?.status, "sent");
  });
});
