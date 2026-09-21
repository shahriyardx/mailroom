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

describe("in light mode", () => {
  it("changes nothing, whatever the message chose", () => {
    const html = `<p style="color:#27272a">Hello</p>`;
    assert.equal(prepare(html, false).html, html);
  });
});
