import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type EmailDesign,
  designToText,
  emptyDesign,
  inline,
  newBlock,
  readDesign,
  renderDesign,
} from "@/lib/email-blocks";

/**
 * What the builder compiles to.
 *
 * This is the only place the blocks on a canvas become the mail somebody
 * receives, and none of it can be checked after the fact: an email that
 * arrives broken has already arrived.
 */

function design(...blocks: ReturnType<typeof newBlock>[]): EmailDesign {
  return { ...emptyDesign(), blocks };
}

describe("compiling a design", () => {
  it("writes a document a mail client will read", () => {
    const html = renderDesign(design(newBlock("heading", "b1")));

    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<table role="presentation"/);
    // Width as an attribute as well as a style: Outlook ignores the style.
    assert.match(html, /width="600"/);
  });

  it("escapes what somebody typed, and leaves a variable alone", () => {
    const block = newBlock("heading", "b1");
    const html = renderDesign(design({ ...block, text: "<script>x</script> {{ name }}" } as never));

    assert.ok(!html.includes("<script>"), "markup typed into a heading is text, not markup");
    assert.match(html, /&lt;script&gt;/);
    // The placeholder has to survive: it is filled in when the mail is sent.
    assert.match(html, /\{\{ name \}\}/);
  });

  it("builds a button out of a table, so it has padding in Outlook", () => {
    const html = renderDesign(design(newBlock("button", "b1")));
    assert.match(html, /<td align="center" bgcolor=/);
    assert.match(html, /<a href="https:\/\/example\.com"/);
  });

  it("leaves out an image that has no source", () => {
    const html = renderDesign(design(newBlock("image", "b1")));
    assert.ok(!html.includes("<img"), "an empty image block is nothing, not a broken icon");
  });

  it("sizes an image against the content width, not the page", () => {
    const block = { ...newBlock("image", "b1"), src: "https://x.test/a.png", width: 50 };
    const html = renderDesign(design(block as never));
    // 600 wide, 32px of gutter either side, half of what is left.
    assert.match(html, /width="268"/);
  });

  it("gives a spacer a height a client cannot collapse", () => {
    const html = renderDesign(design({ ...newBlock("spacer", "b1"), size: 40 } as never));
    assert.match(html, /height:40px/);
    assert.match(html, /&nbsp;/);
  });
});

describe("cleaning what the editor produced", () => {
  it("keeps the formatting tags and drops everything else", () => {
    const out = inline("<b>bold</b><script>alert(1)</script><div>x</div>", "#000");
    assert.equal(out, "<b>bold</b>alert(1)x");
  });

  it("drops an attribute, including the ones that run", () => {
    const out = inline('<b onclick="steal()">hi</b>', "#000");
    assert.equal(out, "<b>hi</b>");
  });

  it("only lets a link point somewhere a link may point", () => {
    assert.match(inline('<a href="https://x.test">go</a>', "#111"), /<a href="https:\/\/x\.test"/);
    assert.match(inline('<a href="mailto:a@b.test">mail</a>', "#111"), /mailto:a@b\.test/);
    // javascript: in an email is either a mistake or an attack, and no client
    // would run it anyway — so it does not go out looking like a link.
    assert.equal(inline('<a href="javascript:alert(1)">x</a>', "#111"), "<span>x</span>");
  });

  it("lets a variable stand in for the whole address", () => {
    assert.match(inline('<a href="{{ url }}">go</a>', "#111"), /href="\{\{ url \}\}"/);
  });
});

describe("the plain-text half", () => {
  it("is built from the same blocks, with the links written out", () => {
    const text = designToText(
      design(
        { ...newBlock("heading", "b1"), text: "Welcome" } as never,
        { ...newBlock("text", "b2"), html: "Hello <b>there</b>" } as never,
        { ...newBlock("button", "b3"), text: "Open", href: "https://x.test" } as never,
      ),
    );

    assert.equal(text, "Welcome\n\nHello there\n\nOpen: https://x.test");
  });
});

describe("reading a stored design back", () => {
  it("drops a block it does not recognise rather than rendering it", () => {
    const read = readDesign({
      version: 1,
      theme: {},
      blocks: [newBlock("heading", "b1"), { id: "b2", type: "carousel" }],
    });

    assert.equal(read?.blocks.length, 1);
  });

  it("fills in a theme that was saved by an older release", () => {
    const read = readDesign({ version: 1, blocks: [] });
    assert.equal(read?.theme.width, 600);
  });

  it("says nothing at all when there is nothing to read", () => {
    assert.equal(readDesign(null), null);
    assert.equal(readDesign("{}"), null);
    assert.equal(readDesign({ theme: {} }), null);
  });
});
