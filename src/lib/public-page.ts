/**
 * The pages a stranger sees.
 *
 * Unsubscribing, confirming and signing up are the only screens in this app
 * shown to somebody who has no account and never will. They render in
 * whatever browser a mail client opens, they have to work when the app shell
 * is broken, and they must not wait on a session that does not exist — so
 * they are self-contained HTML with their own styles rather than pages in the
 * React tree.
 */

export function safe(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

const STYLE = `
  :root { color-scheme: light dark; --ink: #18181b; --quiet: #71717a; --bg: #fafafa; --card: #fff; --line: #e4e4e7; --accent: #18181b; --on-accent: #fff; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #fafafa; --quiet: #a1a1aa; --bg: #09090b; --card: #18181b; --line: #27272a; --accent: #fafafa; --on-accent: #09090b; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px;
         background: var(--bg); color: var(--ink);
         font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 26rem; width: 100%; background: var(--card); border: 1px solid var(--line);
         border-radius: 16px; padding: 28px 24px; }
  h1 { margin: 0 0 12px; font-size: 19px; letter-spacing: -0.02em; }
  p { margin: 0 0 10px; }
  .quiet { color: var(--quiet); font-size: 13px; }
  label { display: block; margin: 16px 0 6px; font-size: 13px; color: var(--quiet); }
  input { width: 100%; padding: 9px 11px; font: inherit; font-size: 14px; color: var(--ink);
          background: var(--bg); border: 1px solid var(--line); border-radius: 10px; }
  input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  button { margin-top: 18px; width: 100%; padding: 10px; font: inherit; font-size: 14px;
           font-weight: 500; color: var(--on-accent); background: var(--accent);
           border: 0; border-radius: 10px; cursor: pointer; }
  .bad { color: #dc2626; font-size: 13px; margin-top: 10px; }
  .brand { margin: 0 0 18px; font-size: 12px; font-weight: 600; letter-spacing: .06em;
           text-transform: uppercase; color: var(--quiet); }
`;

/*
 * The same page with the frame taken off, for sitting inside somebody else's.
 *
 * An embedded form has to look like part of the page around it, and a
 * centred card on its own grey background inside a box on a white site looks
 * like exactly what it is. The background goes transparent so it takes the
 * host page's, and the card loses its border and its centring.
 */
const EMBEDDED = `
  body { min-height: 0; display: block; padding: 0; background: transparent; }
  main { max-width: none; border: 0; border-radius: 0; padding: 0; background: transparent; }
`;

/** One self-contained page, ready to hand back as text/html. */
export function publicPage(title: string, body: string, brand?: string | null, embedded = false) {
  /*
   * The company's name above the card, when it has one.
   *
   * This is the only page of the product a subscriber ever sees, and an
   * unbranded box asking for an email address is what a phishing page looks
   * like. A name they recognise is the difference.
   */
  const heading = brand?.trim() ? `<p class="brand">${safe(brand.trim())}</p>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${safe(title)}</title>
<style>${STYLE}${embedded ? EMBEDDED : ""}</style>
</head>
<body><main>${heading}${body}</main></body>
</html>`;
}

/** The headers every one of these answers with. */
export const PUBLIC_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
};

/**
 * The embedded form, said out loud.
 *
 * Nothing here blocks framing today, so this changes no behaviour — it is
 * here so that the day somebody adds a frame-ancestors rule to the app, the
 * one page that is supposed to be in an iframe already says so.
 */
export const EMBED_HEADERS = {
  ...PUBLIC_HEADERS,
  "Content-Security-Policy": "frame-ancestors *",
};
