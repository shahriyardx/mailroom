import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DOC_PAGES, docHref, pageForSlug, siteLink } from "@/lib/docs-nav";
import { highlight } from "@/lib/highlight";
import { renderDoc, summarise } from "@/lib/markdown";
import { docSource, neighbours } from "@/server/docs";

/**
 * The documentation the app serves.
 *
 * The renderer is a subset of Markdown written for exactly these pages, so
 * the only test that means anything is the whole set of them: every page in
 * the menu is opened, parsed and rendered, and what comes out is checked for
 * the marks of a parser that gave up — a fence or a callout printed as the
 * characters that open it.
 */

async function render(path: string) {
  const source = await docSource({ title: "", path });
  assert.ok(source, `${path}.md is in the menu but not on disk`);
  const doc = renderDoc(source as string);
  return { doc, html: renderToStaticMarkup(doc.body as React.ReactElement) };
}

test("every page in the menu has a file, a title and a body", async () => {
  for (const page of DOC_PAGES) {
    const { doc, html } = await render(page.path);
    assert.ok(doc.title.length > 0, `${page.path} has no heading`);
    assert.ok(html.length > 200, `${page.path} rendered almost nothing`);
  }
});

test("nothing is left half-parsed", async () => {
  for (const page of DOC_PAGES) {
    const { html } = await render(page.path);
    // A fence or a container that reached the output verbatim means the
    // block pass walked past it.
    assert.ok(!html.includes("```"), `${page.path} printed a code fence`);
    assert.ok(!html.includes(":::"), `${page.path} printed a container marker`);
    // The Vue escape hatch in the Markdown is not markup anybody should see.
    assert.ok(!html.includes("v-pre"), `${page.path} printed a VitePress attribute`);
  }
});

test("links written for the published site are moved under /docs", async () => {
  const { html } = await render("guide/campaigns");
  assert.ok(html.includes('href="/docs/guide/features"'));
  // An anchor on the same page stays an anchor.
  const idempotency = await render("api/idempotency");
  assert.ok(!idempotency.html.includes('href="/guide/'));
});

test("an external link opens away from the app", async () => {
  const { html } = await render("guide/self-hosting");
  assert.ok(html.includes('target="_blank"'));
});

test("a table, a callout and a sample each become their own element", async () => {
  const { html } = await render("guide/campaigns");
  assert.ok(html.includes("<table"), "no table");
  assert.ok(html.includes("<pre"), "no code sample");
  assert.ok(html.includes("Send yourself a test first"), "no callout title");
});

test("headings become anchors, and the outline points at them", async () => {
  const { doc, html } = await render("api/emails");
  assert.ok(doc.headings.length > 2);
  for (const heading of doc.headings) {
    assert.ok(html.includes(`id="${heading.id}"`), `no anchor for ${heading.text}`);
    assert.ok(!heading.text.includes("`"), "the outline kept its markup");
  }
  // Two headings with the same words still get one anchor each.
  const ids = doc.headings.map((heading) => heading.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("the screenshot the guide shows is served by this app", async () => {
  const { html } = await render("guide/receiving");
  assert.ok(html.includes("/doc-assets/shots/cloudflare-token.png"));
});

test("a URL maps to the file the menu names", () => {
  assert.equal(pageForSlug(["guide"])?.path, "guide/index");
  assert.equal(pageForSlug(["guide", "campaigns"])?.path, "guide/campaigns");
  assert.equal(pageForSlug(["guide", "nothing"]), null);
  // Nothing outside the menu is reachable, whatever the URL says.
  assert.equal(pageForSlug(["..", "..", "package.json"]), null);
});

test("the two readers agree on where a page lives", () => {
  assert.equal(docHref("guide/index"), "/docs/guide");
  assert.equal(docHref("guide/campaigns"), "/docs/guide/campaigns");
  assert.equal(siteLink("guide/index"), "/guide/");
  assert.equal(siteLink("guide/campaigns"), "/guide/campaigns");
});

test("each page knows the one before and after it", () => {
  const first = neighbours(DOC_PAGES[0]);
  assert.equal(first.previous, null);
  assert.equal(first.next?.path, DOC_PAGES[1].path);

  const last = neighbours(DOC_PAGES[DOC_PAGES.length - 1]);
  assert.equal(last.next, null);
});

/** The markup with its tags taken off, to compare against what went in. */
function text(markup: string) {
  return markup
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

test("colouring a sample changes how it looks, never what it says", () => {
  const samples: [string, string][] = [
    ["ts", 'const sent = await mail.emails.send({ to: "a@example.net" }); // one'],
    ["json", '{ "id": "msg_1", "count": 12, "ok": true }'],
    ["sh", 'curl -X POST https://example.com \\\n  -H "Authorization: Bearer mk_live_x"'],
    ["html", '<iframe src="/subscribe/lst_1" title="Subscribe"></iframe>'],
    ["txt", "1. Open chrome://extensions"],
  ];

  for (const [language, code] of samples) {
    const markup = renderToStaticMarkup(highlight(code, language) as React.ReactElement);
    assert.equal(text(markup), code, `${language} lost or gained characters`);
  }
});

test("a keyword, a string and a comment each get their own colour", () => {
  const markup = renderToStaticMarkup(
    highlight('const name = "Ada"; // who', "ts") as React.ReactElement,
  );
  assert.ok(markup.includes(">const</span>"), "no keyword");
  assert.ok(markup.includes(">&quot;Ada&quot;</span>"), "no string");
  assert.ok(markup.includes(">// who</span>"), "no comment");

  // A plain-text sample is left alone: nothing in it means anything.
  const plain = renderToStaticMarkup(highlight("just words", "txt") as React.ReactElement);
  assert.equal(plain, "just words");
});

test("a key in JSON is told apart from a value", () => {
  const markup = renderToStaticMarkup(highlight('{ "id": "msg_1" }', "json") as React.ReactElement);
  // Two strings, coloured differently: the name of the field and its value.
  assert.ok(markup.includes("text-info"), "the key is not marked as a key");
  assert.ok(markup.includes("text-ok"), "the value is not marked as a string");
});

test("the samples on a page come out coloured", async () => {
  const { html } = await render("sdk/sending");
  assert.ok(html.includes("text-primary"), "no keyword colour in a rendered page");
});

test("a summary is a sentence, not a heading or a table row", async () => {
  const source = await docSource({ title: "", path: "guide/campaigns" });
  const summary = summarise(source as string);
  assert.ok(summary.length > 40);
  assert.ok(!summary.startsWith("#"));
  assert.ok(!summary.includes("|"));
});
