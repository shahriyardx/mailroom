/**
 * Email HTML is rendered inside a sandboxed iframe, so this pass only has to
 * remove things the sandbox cannot neutralise (active content and trackers)
 * and defer remote images until the reader asks for them.
 */
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function prepareEmailHtml(
  html: string,
  options: { showRemoteImages: boolean; inlineImages?: Record<string, string> },
) {
  let output = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[^>]*>/gi, "")
    .replace(/<meta[^>]*http-equiv=["']?refresh[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "blocked:");

  // Swap cid: references for the inline attachment URLs we stored in R2.
  const inline = options.inlineImages ?? {};
  output = output.replace(/(["'(])cid:([^"')\s]+)/gi, (match, prefix: string, cid: string) => {
    const url = inline[cid] ?? inline[`<${cid}>`];
    return url ? `${prefix}${url}` : match;
  });

  let blockedImages = 0;
  if (!options.showRemoteImages) {
    // Swap the real source for a transparent pixel so the browser shows our
    // placeholder instead of its own broken-image glyph.
    output = output.replace(
      /<img([^>]*?)\ssrc\s*=\s*("https?:\/\/[^"]*"|'https?:\/\/[^']*')/gi,
      (_match, attrs: string, src: string) => {
        blockedImages += 1;
        return `<img${attrs} data-blocked-src=${src} src="${TRANSPARENT_PIXEL}"`;
      },
    );
    output = output.replace(/\ssrcset\s*=\s*("[^"]*"|'[^']*')/gi, (match) => {
      if (/https?:\/\//i.test(match)) blockedImages += 1;
      return " data-blocked-srcset";
    });

    output = output.replace(
      /(<[^>]+style\s*=\s*"[^"]*?)url\((["']?)https?:\/\/[^)]*\2\)/gi,
      (_match, head: string) => {
        blockedImages += 1;
        return `${head}none`;
      },
    );
  }

  // Open every link in a new tab and drop the referrer.
  output = output.replace(/<a\s([^>]*)>/gi, (_match, attrs: string) => {
    const cleaned = attrs.replace(/\starget\s*=\s*("[^"]*"|'[^']*'|\S+)/gi, "");
    return `<a ${cleaned} target="_blank" rel="noopener noreferrer nofollow">`;
  });

  return { html: output, blockedImages };
}

export const EMAIL_FRAME_STYLES = `
  :root { color-scheme: light; }
  :root.dark { color-scheme: dark; }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.55;
    color: #0f172a;
    background: transparent;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .dark body { color: #e2e8f0; }
  .dark blockquote { border-left-color: #475569; color: #94a3b8; }
  .dark a { color: #a5b4fc; }
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
  /* Trim the leading and trailing whitespace most mail clients add. */
  body > *:first-child { margin-top: 0; }
  body > *:last-child { margin-bottom: 0; }
`;
