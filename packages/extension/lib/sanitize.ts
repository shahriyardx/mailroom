import DOMPurify from "dompurify";

/**
 * Turning a stranger's HTML into something safe to draw in the popup.
 *
 * The web app does this with a hand-written pass because it runs on the
 * server, where there is no DOM. Here there is one, so DOMPurify does the
 * removing and this file only decides the policy: no active content, no
 * remote images until the reader asks, every link leaving in a new tab.
 *
 * The result is still rendered inside a sandboxed iframe. Two layers, because
 * neither one is worth betting a reader's session on alone.
 */

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export interface PreparedEmail {
  html: string;
  /** How many remote images the message carries, blocked or not. */
  remoteImages: number;
  blockedImages: number;
}

export function prepareEmail(
  source: string,
  options: { showRemoteImages: boolean },
): PreparedEmail {
  const clean = DOMPurify.sanitize(source, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "base"],
    FORBID_ATTR: ["srcset", "ping", "formaction"],
    ALLOW_DATA_ATTR: false,
    // `cid:` images are attachments this extension does not download, so they
    // are left to fail as broken references rather than being reached for.
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|data:image\/(?:png|gif|jpeg|webp);base64,)/i,
    RETURN_DOM_FRAGMENT: false,
  });

  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, "text/html");

  let remoteImages = 0;
  let blockedImages = 0;

  for (const image of Array.from(doc.querySelectorAll("img"))) {
    const src = image.getAttribute("src") ?? "";
    if (!/^https?:/i.test(src)) continue;
    remoteImages += 1;
    if (options.showRemoteImages) continue;
    image.setAttribute("data-blocked-src", src);
    image.setAttribute("src", TRANSPARENT_PIXEL);
    blockedImages += 1;
  }

  // An inline background image is a tracking pixel as often as it is a
  // design, and it never survives being blocked by the img rule above.
  if (!options.showRemoteImages) {
    for (const node of Array.from(doc.querySelectorAll<HTMLElement>("[style]"))) {
      const style = node.getAttribute("style") ?? "";
      if (!/url\(\s*['"]?https?:/i.test(style)) continue;
      node.setAttribute("style", style.replace(/url\(\s*['"]?https?:[^)]*\)/gi, "none"));
      blockedImages += 1;
    }
  }

  for (const link of Array.from(doc.querySelectorAll("a"))) {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer nofollow");
  }

  return { html: doc.body.innerHTML, remoteImages, blockedImages };
}

/** Plain text, wrapped so it reads like the message it was typed as. */
export function textToHtml(text: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer nofollow">$1</a>',
  );
  return `<div style="white-space:pre-wrap">${linked}</div>`;
}

/**
 * The stylesheet the frame carries. Kept close to the web app's so a message
 * does not change shape between the popup and the tab.
 */
export const FRAME_STYLES = `
  html { scrollbar-width: none; }
  html::-webkit-scrollbar { width: 0; height: 0; }
  :root { color-scheme: light; }
  :root.dark { color-scheme: dark; }
  body {
    margin: 0;
    padding: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.55;
    color: #0f172a;
    background: transparent;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  :root.dark body { color: #e2e8f0; }
  :root.dark blockquote { border-left-color: #475569; color: #94a3b8; }
  :root.dark a { color: #a5b4fc; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #4f46e5; }
  blockquote {
    margin: 8px 0 8px 4px;
    padding-left: 12px;
    border-left: 2px solid #cbd5e1;
    color: #64748b;
  }
  pre { white-space: pre-wrap; word-break: break-word; }
  img[data-blocked-src] {
    width: 22px !important;
    height: 22px !important;
    max-width: 22px;
    background: repeating-linear-gradient(45deg, #cbd5e133, #cbd5e133 5px, transparent 5px, transparent 10px);
    border: 1px dashed #94a3b8;
    border-radius: 3px;
  }
  body > *:first-child { margin-top: 0; }
  body > *:last-child { margin-bottom: 0; }
`;
