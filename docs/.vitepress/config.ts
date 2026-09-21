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
const SITE = "https://docs.shahriyar.dev";

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

    sidebar: {
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
            { text: "Mailboxes and people", link: "/guide/mailboxes" },
            { text: "API keys", link: "/guide/api-keys" },
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
    },

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
