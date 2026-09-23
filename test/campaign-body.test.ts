import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { merge, withFooter } from "@/lib/campaign-body";

/**
 * The bits every bulk email is required to carry.
 *
 * None of this can be checked after the fact: a campaign that went out without
 * a way to unsubscribe has already gone out, and the complaint that follows is
 * counted against every other message from the same domain.
 */

const URL = "https://mail.example.test/unsubscribe/abc.def";
const ADDRESS = "Acme Ltd\n12 Example Street\nLondon EC1A 1AA";

describe("filling in a recipient", () => {
  it("puts the name and address where they were asked for", () => {
    const out = merge("Hello {{name}} at {{address}}", {
      address: "ada@example.com",
      name: "Ada",
    });
    assert.equal(out, "Hello Ada at ada@example.com");
  });

  it('says "there" rather than the address when there is no name', () => {
    // "Hello ada@example.com" is the most recognisable sign of a mail merge
    // going wrong, and it is worse than not using a name at all.
    const out = merge("Hello {{name}}", { address: "ada@example.com", name: null });
    assert.equal(out, "Hello there");
  });

  it("fills in any other field the person carries", () => {
    const out = merge("Your {{plan}} plan in {{city}}", {
      address: "ada@example.com",
      name: "Ada",
      fields: { plan: "Pro", city: "London" },
    });
    assert.equal(out, "Your Pro plan in London");
  });

  it("does not care how the field was capitalised or spaced", () => {
    // A CSV exported from somewhere else carries whatever header it carries.
    const out = merge("{{plan_name}} / {{PLANNAME}} / {{plan name}}", {
      address: "ada@example.com",
      name: null,
      fields: { "Plan Name": "Pro" },
    });
    assert.equal(out, "Pro / Pro / Pro");
  });

  it("uses the fallback after the pipe when the field is empty", () => {
    const out = merge("Your {{plan|free}} plan", {
      address: "ada@example.com",
      name: null,
      fields: {},
    });
    assert.equal(out, "Your free plan");
  });

  it("leaves nothing behind for a field nobody has", () => {
    // The one thing it must never do is reach the reader as "{{plan}}".
    const out = merge("Hi{{plan}}", { address: "ada@example.com", name: null });
    assert.equal(out, "Hi");
  });

  it("leaves the unsubscribe placeholder for the footer", () => {
    const out = merge("Bye {{unsubscribe}}", { address: "ada@example.com", name: null });
    assert.equal(out, "Bye {{unsubscribe}}");
  });

  it("escapes a field value on its way into HTML", () => {
    // Field values come from CSV files and API calls. One with a tag in it
    // must not be able to close ours in mail that has already gone out.
    const out = merge(
      "<p>{{plan}}</p>",
      {
        address: "ada@example.com",
        name: null,
        fields: { plan: '<script>alert("x")</script>' },
      },
      true,
    );
    assert.ok(!out.includes("<script>"));
    assert.ok(out.includes("&lt;script&gt;"));
  });

  it("does not escape the same value in a plain text body", () => {
    const out = merge("{{note}}", {
      address: "ada@example.com",
      name: null,
      fields: { note: "5 > 3" },
    });
    assert.equal(out, "5 > 3");
  });

  it("lets the real name win over a field called name", () => {
    const out = merge("{{name}}", {
      address: "ada@example.com",
      name: "Ada",
      fields: { name: "Wrong" },
    });
    assert.equal(out, "Ada");
  });
});

describe("the footer", () => {
  it("adds a way out when the writer did not", () => {
    const out = withFooter("<p>Hello</p>", { unsubscribeUrl: URL }, true);
    assert.ok(out.includes(URL));
    assert.ok(out.includes("Unsubscribe"));
  });

  it("puts the link where the writer asked for it instead", () => {
    const out = withFooter(
      '<p>Leave <a href="{{unsubscribe}}">here</a></p>',
      { unsubscribeUrl: URL },
      true,
    );
    assert.ok(out.includes(`href="${URL}"`));
    // Their own wording, so no block of ours after it.
    assert.ok(!out.includes("Unsubscribe from these emails"));
  });

  it("prints the postal address even when the writer placed the link", () => {
    // The link is a matter of taste. The address is a matter of law.
    const out = withFooter(
      '<p>Leave <a href="{{unsubscribe}}">here</a></p>',
      { unsubscribeUrl: URL, postalAddress: ADDRESS },
      true,
    );
    assert.ok(out.includes("Acme Ltd"));
    assert.ok(out.includes("London EC1A 1AA"));
  });

  it("breaks the address over lines rather than running it together", () => {
    const out = withFooter("<p>Hi</p>", { unsubscribeUrl: URL, postalAddress: ADDRESS }, true);
    assert.ok(out.includes("Acme Ltd<br>12 Example Street"));
  });

  it("escapes an address that contains markup", () => {
    const out = withFooter(
      "<p>Hi</p>",
      { unsubscribeUrl: URL, postalAddress: "Acme <script>alert(1)</script>" },
      true,
    );
    assert.ok(!out.includes("<script>"));
    assert.ok(out.includes("&lt;script&gt;"));
  });

  it("writes a plain-text footer without any markup in it", () => {
    const out = withFooter("Hello", { unsubscribeUrl: URL, postalAddress: ADDRESS }, false);
    assert.ok(out.includes(`Unsubscribe: ${URL}`));
    // One line, commas rather than newlines: a text part is read in a window
    // that may be four lines tall.
    assert.ok(out.includes("Acme Ltd, 12 Example Street, London EC1A 1AA"));
    assert.ok(!out.includes("<"));
  });

  it("adds nothing but the link when there is no address to add", () => {
    const out = withFooter("<p>Hi</p>", { unsubscribeUrl: URL, postalAddress: null }, true);
    assert.ok(out.includes("Unsubscribe from these emails"));
    assert.ok(!out.includes("<br><br>"));
  });
});

describe("the web copy of a campaign", () => {
  it("round-trips a signed token", async () => {
    process.env.BETTER_AUTH_SECRET ??= "test-secret-for-archive-tests";
    const { archiveToken, readArchiveToken } = await import("@/server/campaigns");
    assert.equal(readArchiveToken(archiveToken("bcast_1")), "bcast_1");
  });

  it("refuses a token signed for something else", async () => {
    // An unsubscribe link that also worked as an archive link, or the other
    // way round, is the sort of bug nobody finds until it matters.
    process.env.BETTER_AUTH_SECRET ??= "test-secret-for-archive-tests";
    const { readArchiveToken, unsubscribeToken } = await import("@/server/campaigns");
    assert.equal(readArchiveToken(unsubscribeToken("bcast_1")), null);
  });

  it("refuses a tampered id", async () => {
    process.env.BETTER_AUTH_SECRET ??= "test-secret-for-archive-tests";
    const { archiveToken, readArchiveToken } = await import("@/server/campaigns");
    const token = archiveToken("bcast_1");
    assert.equal(readArchiveToken(token.replace("bcast_1", "bcast_2")), null);
  });
});
