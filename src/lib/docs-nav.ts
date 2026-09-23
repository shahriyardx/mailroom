/**
 * Every documentation page, once.
 *
 * The same list drives two readers: the documentation built into the app, and
 * the VitePress site published from `docs/`. A page that is in one menu and
 * missing from the other is the sort of drift nobody notices until somebody
 * follows a link that goes nowhere, so there is one list and both read it.
 *
 * `path` is the Markdown file under `docs/`, without the extension. An index
 * page is written out in full — `guide/index` — because the file is what this
 * names; the two helpers below turn it into whichever URL is being asked for.
 */

export interface DocPage {
  title: string;
  /** The source file under `docs/`, without `.md`. */
  path: string;
}

export interface DocGroup {
  title: string;
  pages: DocPage[];
}

export interface DocSection {
  /** First segment of the path, and the key the site menus by. */
  key: string;
  title: string;
  /** One line, shown on the documentation home. */
  blurb: string;
  groups: DocGroup[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    key: "guide",
    title: "Guide",
    blurb: "What this is, how it fits together, and how to run it.",
    groups: [
      {
        title: "Getting started",
        pages: [
          { title: "What it is", path: "guide/index" },
          { title: "How it fits together", path: "guide/architecture" },
          { title: "Self-hosting it", path: "guide/self-hosting" },
        ],
      },
      {
        title: "Running it",
        pages: [
          { title: "Sending domains", path: "guide/domains" },
          { title: "Receiving mail", path: "guide/receiving" },
          { title: "Forwarding", path: "guide/forwarding" },
          { title: "Campaigns", path: "guide/campaigns" },
          { title: "Automations", path: "guide/automations" },
          { title: "Metrics", path: "guide/metrics" },
          { title: "Templates and media", path: "guide/templates" },
          { title: "Features", path: "guide/features" },
          { title: "Mailboxes and people", path: "guide/mailboxes" },
          { title: "API keys", path: "guide/api-keys" },
          { title: "Test keys", path: "guide/test-mode" },
          { title: "The send queue", path: "guide/queue" },
          { title: "Desktop notifications", path: "guide/notifications" },
          { title: "Browser extension", path: "guide/extension" },
        ],
      },
    ],
  },
  {
    key: "api",
    title: "API",
    blurb: "The REST API on this instance, at /api/v1.",
    groups: [
      {
        title: "Using the API",
        pages: [
          { title: "Overview", path: "api/index" },
          { title: "Scopes and reach", path: "api/scopes" },
          { title: "Pagination", path: "api/pagination" },
          { title: "Errors", path: "api/errors" },
          { title: "Idempotency and limits", path: "api/idempotency" },
        ],
      },
      {
        title: "Endpoints",
        pages: [
          { title: "Emails", path: "api/emails" },
          { title: "Templates", path: "api/templates" },
          { title: "Threads", path: "api/threads" },
          { title: "Messages and files", path: "api/messages" },
          { title: "Mailboxes", path: "api/mailboxes" },
          { title: "Domains", path: "api/domains" },
          { title: "Labels and contacts", path: "api/labels" },
          { title: "Blocked addresses", path: "api/suppressions" },
          { title: "Events", path: "api/events" },
          { title: "Webhooks", path: "api/webhooks" },
          { title: "Statistics", path: "api/stats" },
        ],
      },
    ],
  },
  {
    key: "sdk",
    title: "SDK",
    blurb: "The typed Node client, with no dependencies of its own.",
    groups: [
      {
        title: "Node SDK",
        pages: [
          { title: "Getting started", path: "sdk/index" },
          { title: "Sending", path: "sdk/sending" },
          { title: "Reading mail", path: "sdk/reading" },
          { title: "Managing the account", path: "sdk/managing" },
          { title: "Errors and retries", path: "sdk/errors" },
        ],
      },
    ],
  },
  {
    key: "webhooks",
    title: "Webhooks",
    blurb: "What this instance calls you about, and how to trust the call.",
    groups: [
      {
        title: "Webhooks",
        pages: [
          { title: "Overview", path: "webhooks/index" },
          { title: "The events", path: "webhooks/events" },
          { title: "Verifying a call", path: "webhooks/verifying" },
          { title: "Retries and replays", path: "webhooks/retries" },
        ],
      },
    ],
  },
];

/** Every page, flattened, in the order the menu shows them. */
export const DOC_PAGES: DocPage[] = DOC_SECTIONS.flatMap((section) =>
  section.groups.flatMap((group) => group.pages),
);

/**
 * Where a page lives in the app: `guide/index` -> `/docs/guide`.
 *
 * The app serves the documentation under one prefix so a link in the Markdown
 * — which is written for the published site, and so starts at the root — can
 * be mapped by prefixing it rather than by rewriting the Markdown.
 */
export function docHref(path: string) {
  const trimmed = path.replace(/\/index$/, "");
  return `/docs/${trimmed}`;
}

/** Where the same page lives on the published site: `guide/index` -> `/guide/`. */
export function siteLink(path: string) {
  return path.endsWith("/index") ? `/${path.replace(/index$/, "")}` : `/${path}`;
}

/** The file under `docs/` a URL asks for, or null if no such page is listed. */
export function pageForSlug(slug: string[]): DocPage | null {
  const joined = slug.join("/");
  return DOC_PAGES.find((page) => page.path === joined || page.path === `${joined}/index`) ?? null;
}
