import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "vitepress";

/**
 * The product name, in one place.
 *
 * It appears in prose across the Markdown too, so a rename is this constant
 * plus one search and replace — not a hunt.
 */
const NAME = "Mailroom";
const TAGLINE = "Self-hosted mail on Amazon SES and Cloudflare";
const REPO = "https://github.com/shahriyardx/mailroom";
const SITE = "https://mailroom-docs.shahriyar.dev";

/**
 * The sidebar, lifted out so the llms.txt generator can walk exactly what the
 * site navigates by. One list, so a page cannot be in the menu and missing
 * from the machine-readable index.
 */
const SIDEBAR = {
  "/guide/": [
    {
      text: "Getting started",
      items: [
        { text: "What it is", link: "/guide/" },
        { text: "How it fits together", link: "/guide/architecture" },
        { text: "Self-hosting it", link: "/guide/self-hosting" },
      ],
    },
    {
      text: "Running it",
      items: [
        { text: "Sending domains", link: "/guide/domains" },
        { text: "Receiving mail", link: "/guide/receiving" },
        { text: "Forwarding", link: "/guide/forwarding" },
        { text: "Campaigns", link: "/guide/campaigns" },
        { text: "Automations", link: "/guide/automations" },
        { text: "Metrics", link: "/guide/metrics" },
        { text: "Templates and media", link: "/guide/templates" },
        { text: "Features", link: "/guide/features" },
        { text: "Mailboxes and people", link: "/guide/mailboxes" },
        { text: "API keys", link: "/guide/api-keys" },
        { text: "Test keys", link: "/guide/test-mode" },
        { text: "The send queue", link: "/guide/queue" },
        { text: "Desktop notifications", link: "/guide/notifications" },
        { text: "Browser extension", link: "/guide/extension" },
      ],
    },
  ],

  "/api/": [
    {
      text: "Using the API",
      items: [
        { text: "Overview", link: "/api/" },
        { text: "Scopes and reach", link: "/api/scopes" },
        { text: "Pagination", link: "/api/pagination" },
        { text: "Errors", link: "/api/errors" },
        { text: "Idempotency and limits", link: "/api/idempotency" },
      ],
    },
    {
      text: "Endpoints",
      items: [
        { text: "Emails", link: "/api/emails" },
        { text: "Templates", link: "/api/templates" },
        { text: "Threads", link: "/api/threads" },
        { text: "Messages and files", link: "/api/messages" },
        { text: "Mailboxes", link: "/api/mailboxes" },
        { text: "Domains", link: "/api/domains" },
        { text: "Labels and contacts", link: "/api/labels" },
        { text: "Blocked addresses", link: "/api/suppressions" },
        { text: "Webhooks", link: "/api/webhooks" },
        { text: "Statistics", link: "/api/stats" },
      ],
    },
  ],

  "/sdk/": [
    {
      text: "Node SDK",
      items: [
        { text: "Getting started", link: "/sdk/" },
        { text: "Sending", link: "/sdk/sending" },
        { text: "Reading mail", link: "/sdk/reading" },
        { text: "Managing the account", link: "/sdk/managing" },
        { text: "Errors and retries", link: "/sdk/errors" },
      ],
    },
  ],

  "/webhooks/": [
    {
      text: "Webhooks",
      items: [
        { text: "Overview", link: "/webhooks/" },
        { text: "The events", link: "/webhooks/events" },
        { text: "Verifying a call", link: "/webhooks/verifying" },
        { text: "Retries and replays", link: "/webhooks/retries" },
      ],
    },
  ],
};

/** Every page in the sidebar, flattened, in the order the menu shows them. */
function sidebarPages(): { text: string; link: string }[] {
  const out: { text: string; link: string }[] = [];
  for (const groups of Object.values(SIDEBAR)) {
    for (const group of groups) {
      for (const item of group.items) out.push(item);
    }
  }
  return out;
}

/** "/api/emails" -> "api/emails.md", "/guide/" -> "guide/index.md" */
function sourceOf(link: string) {
  const path = link.replace(/^\//, "");
  return path.endsWith("/") ? `${path}index.md` : `${path}.md`;
}

/** Frontmatter is for the renderer, not for a reader. */
function stripFrontmatter(markdown: string) {
  return markdown.startsWith("---")
    ? markdown.slice(markdown.indexOf("\n---", 3) + 4).replace(/^\n+/, "")
    : markdown;
}

/**
 * The first real sentence of a page, for the index listing.
 *
 * Skips the heading, and skips the container directives and tables that some
 * pages open with, because "| | |" tells a reader nothing.
 */
function summaryOf(markdown: string) {
  for (const block of stripFrontmatter(markdown).split(/\n\s*\n/)) {
    const line = block.trim();
    if (!line || line.startsWith("#") || line.startsWith(":::")) continue;
    if (line.startsWith("|") || line.startsWith("```") || line.startsWith("-")) continue;
    const sentence = line.replace(/\n/g, " ").replace(/\s+/g, " ");
    // A page that opens with its menu path — "**Settings → Domains.**" — has
    // said nothing yet. Keep reading rather than repeating the title.
    if (sentence.length < 60) continue;
    return sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence;
  }
  return "";
}

/**
 * Writes llms.txt and llms-full.txt beside the built site.
 *
 * Generated from the same Markdown the pages are built from, so they cannot
 * drift: a page that is edited, renamed or removed changes both on the next
 * build. See https://llmstxt.org.
 */
async function writeLlmsFiles(srcDir: string, outDir: string) {
  const pages = sidebarPages();
  const sources = await Promise.all(
    pages.map(async (page) => ({
      ...page,
      markdown: await readFile(join(srcDir, sourceOf(page.link)), "utf8"),
    })),
  );

  const section = (prefix: string) =>
    sources
      .filter((page) => page.link.startsWith(prefix))
      .map((page) => {
        const summary = summaryOf(page.markdown);
        return `- [${page.text}](${SITE}${page.link}): ${summary}`;
      })
      .join("\n");

  const index = `# ${NAME}

> ${TAGLINE}. One company runs one instance, against its own Postgres and its own R2 bucket, with as many people in it as they invite.

${NAME} exposes a REST API at \`/api/v1\` on your own instance, authenticated with a bearer key (\`mk_live_…\`). Keys carry scopes, which say what kind of call is allowed, and reach, which says which mailboxes those calls may touch. Lists are cursor-paginated; sends accept an \`Idempotency-Key\`. There is a typed Node SDK, \`@shahriyardx/mailroom\`, with no dependencies.

## Guide

${section("/guide")}

## API

${section("/api")}

## SDK

${section("/sdk")}

## Webhooks

${section("/webhooks")}

## Optional

- [Everything on one page](${SITE}/llms-full.txt): every page above, concatenated.
- [Source](${REPO}): the repository, MIT licensed.
`;

  const full = `# ${NAME}

> ${TAGLINE}

Every documentation page, concatenated. Generated from ${SITE}.

${sources
  .map(
    (page) =>
      `\n\n---\n\n# ${page.text}\n\nSource: ${SITE}${page.link}\n\n${stripFrontmatter(page.markdown).trim()}`,
  )
  .join("\n")}
`;

  await writeFile(join(outDir, "llms.txt"), index, "utf8");
  await writeFile(join(outDir, "llms-full.txt"), full, "utf8");
  console.log(`  llms.txt and llms-full.txt written for ${pages.length} pages`);
}

export default defineConfig({
  title: NAME,
  description: TAGLINE,
  lang: "en-GB",
  // Cloudflare serves /guide/ from /guide.html without the extension, and
  // clean URLs are what the links here assume.
  cleanUrls: true,
  lastUpdated: true,
  // A typo in a link should fail the build, not ship.
  ignoreDeadLinks: false,

  head: [
    ["link", { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: `${NAME} — ${TAGLINE}` }],
    ["meta", { property: "og:description", content: TAGLINE }],
    ["meta", { name: "theme-color", content: "#5b53d8" }],
  ],

  sitemap: { hostname: SITE },

  async buildEnd(siteConfig) {
    await writeLlmsFiles(siteConfig.srcDir, siteConfig.outDir);
  },

  themeConfig: {
    siteTitle: NAME,

    nav: [
      { text: "Guide", link: "/guide/", activeMatch: "/guide/" },
      { text: "API", link: "/api/", activeMatch: "/api/" },
      { text: "SDK", link: "/sdk/", activeMatch: "/sdk/" },
      { text: "Webhooks", link: "/webhooks/", activeMatch: "/webhooks/" },
      {
        text: "Links",
        items: [
          { text: "GitHub", link: REPO },
          { text: "npm", link: "https://www.npmjs.com/package/@shahriyardx/mailroom" },
        ],
      },
    ],

    sidebar: SIDEBAR,

    socialLinks: [{ icon: "github", link: REPO }],

    editLink: {
      pattern: `${REPO}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },

    search: { provider: "local" },

    footer: {
      message: "Released under the MIT Licence.",
      copyright: "© 2026 Md Shahriyar Alam",
    },

    outline: { level: [2, 3] },
  },
});
