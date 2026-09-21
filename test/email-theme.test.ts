import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareEmailHtml } from "@/lib/sanitize-email";

/**
 * Whether a message follows the app's theme or keeps its own colours turns on
 * one question: did it paint its own page? Get that wrong in one direction and
 * a designed newsletter is torn apart; wrong in the other and a plain note is
 * rendered near-black on a dark page.
 */

const prepare = (html: string, dark = true) =>
  prepareEmailHtml(html, { showRemoteImages: true, dark });

describe("a message that paints its own page", () => {
  it("is recognised by a background on a wrapper", () => {
    const html = `<div style="background:#f4f4f5;padding:32px"><p style="color:#18181b">Hi</p></div>`;
    const out = prepare(html);
    assert.equal(out.ownsBackground, true);
    assert.match(out.html, /color:#18181b/, "its colours are left alone");
  });

  it("is recognised by the bgcolor attribute old templates use", () => {
    const out = prepare(`<table bgcolor="#ffffff"><tr><td>Hi</td></tr></table>`);
    assert.equal(out.ownsBackground, true);
  });

  it("is recognised by a gradient", () => {
    const out = prepare(`<div style="background:linear-gradient(#fff,#eee)">Hi</div>`);
    assert.equal(out.ownsBackground, true);
  });

  it("is not fooled by a background that paints nothing", () => {
    const out = prepare(`<div style="background:transparent"><p style="color:#000">Hi</p></div>`);
    assert.equal(out.ownsBackground, false);
  });
});

describe("a plain message on a dark page", () => {
  it("loses the text colour that would swallow it", () => {
    const out = prepare(`<p style="color:#27272a;font-size:15px">Hello</p>`);
    assert.equal(out.ownsBackground, false);
    assert.doesNotMatch(out.html, /color:#27272a/);
    assert.match(out.html, /font-size:15px/, "the rest of the style survives");
  });

  it("keeps a colour bright enough to read", () => {
    const out = prepare(`<p style="color:#7dd3fc">Hello</p>`);
    assert.match(out.html, /color:#7dd3fc/);
  });

  it("drops the style attribute entirely when nothing is left of it", () => {
    const out = prepare(`<p style="color:#000">Hello</p>`);
    assert.equal(out.html, "<p>Hello</p>");
  });

  it("understands rgb() and named colours", () => {
    assert.doesNotMatch(prepare(`<p style="color:rgb(20, 20, 24)">a</p>`).html, /color:/);
    assert.doesNotMatch(prepare(`<p style="color:black">a</p>`).html, /color:/);
    assert.match(prepare(`<p style="color:rgb(240,240,240)">a</p>`).html, /color:rgb/);
  });

  it("drops the colour attribute of a font tag", () => {
    const out = prepare(`<font color="#111111" face="Arial">Hello</font>`);
    assert.doesNotMatch(out.html, /color=/);
    assert.match(out.html, /face="Arial"/);
  });

  it("leaves a background colour alone — only text colours are at stake", () => {
    const out = prepare(`<td background-color="#fff" style="color:#000;padding:4px">a</td>`);
    assert.match(out.html, /padding:4px/);
    assert.doesNotMatch(out.html, /color:#000/);
  });
});

describe("a reply with something quoted under it", () => {
  // What the screenshot showed: two lines of your own, then the newsletter
  // you were replying to, carried along whole with its own white card.
  const reply = [
    `<div style="color:#27272a">Thanks for the information</div>`,
    `<div style="color:#27272a">On Tue, billing@ccbot.app wrote:</div>`,
    `<blockquote style="border-left:1px solid #ccc;padding-left:12px">`,
    `<div style="background:#f4f4f5;padding:32px">`,
    `<div style="background:#ffffff"><p style="color:#18181b">Advanced is live</p></div>`,
    "</div>",
    "</blockquote>",
  ].join("");

  it("is not treated as designed just because the quote was", () => {
    const out = prepare(reply);
    assert.equal(out.ownsBackground, false, "the lines you wrote painted no page");
  });

  it("frees your own words to follow the theme", () => {
    const out = prepare(reply);
    assert.doesNotMatch(out.html, /color:#27272a/, "the reply's own dark text is dropped");
  });

  it("hands the quote back on its own, so it can be folded away", () => {
    const out = prepare(reply);
    assert.ok(out.quoted, "there is something quoted");
    assert.doesNotMatch(out.html, /<blockquote/, "and it is not in the part they wrote");
    assert.match(out.html, /Thanks for the information/);
  });

  it("leaves the quoted message exactly as it arrived", () => {
    const out = prepare(reply);
    assert.match(out.quoted!, /background:#f4f4f5/);
    assert.match(out.quoted!, /color:#18181b/, "the quote keeps the colours its page needs");
    assert.equal(out.quotedOwnsBackground, true);
  });

  it("folds the attribution line in with the quote it introduces", () => {
    const out = prepare(reply);
    assert.doesNotMatch(out.html, /wrote:/, "left behind, it dangles over nothing");
    assert.match(out.quoted!, /billing@ccbot\.app<\/a>> wrote:|wrote:/);
  });

  it("still rescues a quote that brought no page of its own", () => {
    const plain = `<p style="color:#111">Mine</p><blockquote><p style="color:#111">Theirs</p></blockquote>`;
    const out = prepare(plain);
    assert.doesNotMatch(out.html, /color:#111/, "both halves would have been invisible");
  });

  it("treats a quote inside a quote as part of the same carried message", () => {
    const nested = [
      `<p style="color:#27272a">Mine</p>`,
      `<blockquote><div style="background:#fff">`,
      `<blockquote><p style="color:#18181b">Older</p></blockquote>`,
      "</div></blockquote>",
    ].join("");
    const out = prepare(nested);
    assert.equal(out.ownsBackground, false);
    assert.match(out.quoted!, /color:#18181b/, "the inner quote rides on the outer one's page");
    assert.doesNotMatch(out.html, /Older/, "only one quote comes back, not two");
  });
});

describe("in light mode", () => {
  it("changes nothing, whatever the message chose", () => {
    const html = `<p style="color:#27272a">Hello</p>`;
    assert.equal(prepare(html, false).html, html);
  });
});
