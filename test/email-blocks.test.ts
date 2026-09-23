import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type EmailDesign,
  designToText,
  emptyDesign,
  findBlock,
  inline,
  networkOf,
  newBlock,
  patchBlock,
  readDesign,
  relocateBlock,
  renderDesign,
  whereIs,
  youtubeId,
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

  it("sizes an image against the room it has, not against the page", () => {
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

describe("a video in an email", () => {
  it("finds the id in whatever was pasted", () => {
    const wanted = "dQw4w9WgXcQ";
    assert.equal(youtubeId(`https://www.youtube.com/watch?v=${wanted}`), wanted);
    assert.equal(youtubeId(`https://youtu.be/${wanted}`), wanted);
    assert.equal(youtubeId(`https://www.youtube.com/embed/${wanted}`), wanted);
    assert.equal(youtubeId(`https://www.youtube.com/watch?list=x&v=${wanted}`), wanted);
    assert.equal(youtubeId(wanted), wanted);
    assert.equal(youtubeId("https://example.test/video"), null);
    assert.equal(youtubeId(""), null);
  });

  it("goes out as a thumbnail pointing at the video, because nothing plays in mail", () => {
    const block = { ...newBlock("youtube", "b1"), url: "https://youtu.be/dQw4w9WgXcQ" };
    const html = renderDesign(design(block as never));

    assert.ok(!html.includes("<iframe"), "an iframe would be stripped by every client");
    assert.match(html, /img\.youtube\.com\/vi\/dQw4w9WgXcQ\/hqdefault\.jpg/);
    assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
  });

  it("is nothing at all until there is a link", () => {
    assert.equal(renderDesign(design(newBlock("youtube", "b1"))).includes("<img"), false);
  });
});

describe("a table", () => {
  it("draws the first row as headings when it is asked to", () => {
    const html = renderDesign(design(newBlock("table", "b1")));

    assert.match(html, /<th align="left"/);
    assert.match(html, /border-collapse:collapse/);
    assert.match(html, /<td style="[^"]*">One<\/td>/);
  });

  it("draws every row the same when it is not", () => {
    const html = renderDesign(design({ ...newBlock("table", "b1"), header: false } as never));
    assert.ok(!html.includes("<th"), "no heading row means no heading cells");
  });

  it("escapes a cell, so a stray angle bracket stays text", () => {
    const block = { ...newBlock("table", "b1"), header: false, rows: [["<b>x</b>"]] };
    const html = renderDesign(design(block as never));
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  });

  it("reads as rows of text in the plain-text half", () => {
    assert.match(designToText(design(newBlock("table", "b1"))), /Item \| Price/);
  });
});

describe("the play badge on a video", () => {
  const url = "https://youtu.be/dQw4w9WgXcQ";

  it("sits in the middle of the thumbnail, carried every way a client might read it", () => {
    const html = renderDesign(design({ ...newBlock("youtube", "b1"), url } as never));

    assert.match(html, /&#9654;/, "a triangle in a box needs no hosted image");
    // The attribute for the clients that read only that, the CSS for the ones
    // that read only this, and VML for Word, which reads neither.
    assert.match(html, /background="https:\/\/img\.youtube\.com/);
    assert.match(html, /background-image:url\('https:\/\/img\.youtube\.com/);
    assert.match(html, /<v:fill type="frame"/);
    assert.match(html, /valign="middle" align="center"/);
  });

  it("is left off when it is switched off", () => {
    const block = { ...newBlock("youtube", "b1"), url, playButton: false };
    const html = renderDesign(design(block as never));

    assert.ok(!html.includes("&#9654;"));
    assert.match(html, /img\.youtube\.com/, "the thumbnail is still there");
  });
});

describe("the badge does not move what follows it", () => {
  it("takes up room rather than hanging out of its own box", () => {
    const block = { ...newBlock("youtube", "b1"), url: "https://youtu.be/dQw4w9WgXcQ" };
    const html = renderDesign(design(block as never));

    // The badge is inside a cell with a height, not lifted out of one by a
    // negative margin — which collapses, and drags the rest of the email up
    // over the picture.
    assert.ok(!html.includes("margin-top:-"), "nothing is lifted by a negative margin");
    assert.match(html, /height="\d+" valign="middle"/, "the cell reserves the picture's height");
  });
});

describe("colouring part of a line", () => {
  it("keeps a colour set on a selection", () => {
    const out = inline('<span style="color: #ff0000">red</span>', "#111");
    assert.equal(out, '<span style="color:#ff0000;">red</span>');
  });

  it("lets a link carry its own colour instead of the theme's", () => {
    const out = inline('<a href="https://x.test" style="color:#00ff00">go</a>', "#111111");
    assert.match(out, /color:#00ff00/);
    assert.ok(!out.includes("#111111"));
  });

  it("takes nothing that is not a colour", () => {
    // A url(), or a second declaration smuggled in behind a semicolon.
    assert.equal(inline('<span style="color:url(x)">x</span>', "#111"), "<span>x</span>");
    assert.equal(
      inline('<span style="color:red;position:fixed">x</span>', "#111"),
      '<span style="color:red;">x</span>',
    );
  });
});

describe("columns hold blocks", () => {
  it("lays each column out with the same code as the page", () => {
    const columns = {
      ...newBlock("columns", "c1"),
      columns: [
        { blocks: [{ ...newBlock("heading", "h1"), text: "Left" }] },
        { blocks: [{ ...newBlock("button", "b1"), text: "Right" }] },
      ],
    };
    const html = renderDesign(design(columns as never));

    assert.match(html, /<h2[^>]*>Left<\/h2>/);
    assert.match(html, />Right<\/a>/, "a button in a column is still a button");
    assert.match(html, /class="mr-col"/, "and still stacks on a phone");
  });

  it("reads an older design, where a column was one lump of copy", () => {
    const read = readDesign({
      version: 1,
      blocks: [{ id: "c1", type: "columns", gap: 20, columns: [{ html: "Hello" }] }],
    });

    const column = (read?.blocks[0] as { columns: { blocks: { type: string }[] }[] }).columns[0];
    // The copy it had becomes the text block it always meant.
    assert.equal(column?.blocks[0]?.type, "text");
  });

  it("refuses to nest columns inside columns", () => {
    const read = readDesign({
      version: 1,
      blocks: [
        {
          id: "c1",
          type: "columns",
          gap: 20,
          columns: [{ blocks: [{ id: "c2", type: "columns", gap: 20, columns: [] }] }],
        },
      ],
    });

    const column = (read?.blocks[0] as { columns: { blocks: unknown[] }[] }).columns[0];
    // One level is all the renderer draws and all a client lays out reliably.
    assert.equal(column?.blocks.length, 0);
  });
});

describe("moving a block about", () => {
  const columns = {
    ...newBlock("columns", "c1"),
    columns: [{ blocks: [{ ...newBlock("text", "t1"), html: "in" }] }, { blocks: [] }],
  } as never;

  it("finds one wherever it is", () => {
    const blocks = [newBlock("heading", "h1"), columns];
    assert.equal(findBlock(blocks, "t1")?.id, "t1");
    assert.deepEqual(whereIs(blocks, "t1"), { parentId: "c1", column: 0 });
    assert.deepEqual(whereIs(blocks, "h1"), {});
  });

  it("changes one inside a column", () => {
    const blocks = patchBlock([columns], "t1", { html: "out" } as never);
    assert.equal((findBlock(blocks, "t1") as { html: string }).html, "out");
  });

  it("carries one from a column back out to the page", () => {
    const blocks = relocateBlock([columns], "t1", {}, 0);
    assert.equal(blocks[0]?.id, "t1", "it is the first thing on the page now");
    const parent = findBlock(blocks, "c1") as { columns: { blocks: unknown[] }[] };
    assert.equal(parent.columns[0]?.blocks.length, 0);
  });

  it("will not put a columns block inside a column", () => {
    const blocks = [newBlock("columns", "c2"), columns];
    const after = relocateBlock(blocks, "c2", { parentId: "c1", column: 1 }, 0);
    assert.deepEqual(after, blocks, "nothing moved");
  });
});

describe("social links carry icons", () => {
  it("sends a picture per network, addressed where a reader can reach it", () => {
    const block = {
      ...newBlock("social", "s1"),
      links: [{ network: "x", href: "https://x.com/me" }],
    };
    const html = renderDesign(design(block as never), "https://mail.example.com");

    // Not an SVG, which Gmail strips, and not a data: URI, which nothing
    // fetches — a real file at a real address.
    assert.match(html, /src="https:\/\/mail\.example\.com\/social\/x-dark\.png"/);
    assert.match(html, /alt="X"/);
    assert.ok(!html.includes("<svg"));
  });

  it("offers the other tone, because a picture cannot be recoloured", () => {
    const block = {
      ...newBlock("social", "s1"),
      tone: "light",
      links: [{ network: "github", href: "https://github.com/x" }],
    };
    assert.match(renderDesign(design(block as never)), /\/social\/github-light\.png/);
  });

  it("works out the network from the address that was pasted", () => {
    assert.equal(networkOf("https://www.linkedin.com/in/someone"), "linkedin");
    assert.equal(networkOf("https://x.com/someone"), "x");
    assert.equal(networkOf("https://youtu.be/abc"), "youtube");
    assert.equal(networkOf("mailto:hello@example.com"), "email");
    assert.equal(networkOf("https://example.com"), null);
  });

  it("reads the older block, where a link was a label", () => {
    const read = readDesign({
      version: 1,
      blocks: [
        {
          id: "s1",
          type: "social",
          align: "center",
          links: [
            { label: "X", href: "https://x.com/me" },
            { label: "Our blog", href: "https://example.com" },
          ],
        },
      ],
    });

    const links = (read?.blocks[0] as { links: { network: string }[] }).links;
    assert.equal(links[0]?.network, "x", "the address said which one it was");
    assert.equal(links[1]?.network, "website", "and the one that did not is a link to a site");
  });
});

/* -------------------------------------------------------------------------- */

describe("the line the inbox shows", () => {
  it("writes the preheader where no reader will see it", () => {
    const html = renderDesign({
      ...design(newBlock("heading", "b1")),
      preheader: "Ten minutes of setup, and you are sending.",
    });

    assert.match(html, /Ten minutes of setup, and you are sending\./);
    assert.match(html, /display:none;max-height:0/);
    // The padding is what stops the client reading on into the body.
    assert.match(html, /&#847;&zwnj;&nbsp;/);
  });

  it("escapes it, like everything else somebody typed", () => {
    const html = renderDesign({ ...emptyDesign(), preheader: "<b>hi</b>" });
    assert.ok(!html.includes("<b>hi</b>"));
    assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/);
  });

  it("writes nothing at all when there is none", () => {
    const html = renderDesign(design(newBlock("heading", "b1")));
    assert.ok(!html.includes("mso-hide:all"), "an empty preheader is no element");
  });

  it("keeps it when the design is read back", () => {
    const read = readDesign({ version: 1, blocks: [], preheader: "Summary" });
    assert.equal(read?.preheader, "Summary");
  });
});

/* -------------------------------------------------------------------------- */

describe("leaving a block off one size of screen", () => {
  it("hides it on a phone with a class the media query knows", () => {
    const block = { ...newBlock("image", "b1"), src: "https://x/a.png", hideOn: "mobile" };
    const html = renderDesign(design(block as never));

    assert.match(html, /<tr class="mr-no-sm">/);
    assert.match(html, /\.mr-no-sm\{display:none !important/);
  });

  it("hides it on a desktop, Outlook included", () => {
    const block = { ...newBlock("heading", "b1"), hideOn: "desktop" };
    const html = renderDesign(design(block as never));

    // Hidden by default and shown again only by the media query, because
    // that is the only way round that a client without one gets right.
    assert.match(html, /<tr class="mr-only-sm" style="display:none;mso-hide:all;">/);
    assert.match(html, /\.mr-only-sm\{display:table-row !important/);
  });

  it("leaves an ordinary block alone", () => {
    const html = renderDesign(design(newBlock("heading", "b1")));
    assert.match(html, /<tr><td style=/);
  });

  it("puts the media query at the width the email is", () => {
    const wide = { ...emptyDesign(), theme: { ...emptyDesign().theme, width: 900 } };
    assert.match(renderDesign(wide), /max-width:900px/);
  });
});
