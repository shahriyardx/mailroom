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

  it("falls back to the address when there is no name", () => {
    // "Hello ," is worse than "Hello ada@example.com" — a blank greeting reads
    // as a broken mail merge, which is exactly what it is.
    const out = merge("Hello {{name}}", { address: "ada@example.com", name: null });
    assert.equal(out, "Hello ada@example.com");
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
