/**
 * Email HTML is rendered inside a sandboxed iframe, so this pass only has to
 * remove things the sandbox cannot neutralise (active content and trackers)
 * and defer remote images until the reader asks for them.
 */
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Colour names dark enough to disappear against a dark page. Not a full CSS
 * table: these are the handful that turn up in mail written by hand.
 */
const DARK_NAMES = new Set([
  "black",
  "darkblue",
  "darkgreen",
  "darkslategray",
  "darkslategrey",
  "dimgray",
  "dimgrey",
  "midnightblue",
  "navy",
  "maroon",
]);

function channels(value: string): [number, number, number] | null {
  const colour = value.trim().toLowerCase();

  if (DARK_NAMES.has(colour)) return [0, 0, 0];

  const hex = colour.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const digits =
      hex[1]!.length === 3
        ? hex[1]!.split("").map((digit) => digit + digit)
        : [hex[1]!.slice(0, 2), hex[1]!.slice(2, 4), hex[1]!.slice(4, 6)];
    return digits.map((pair) => Number.parseInt(pair, 16)) as [number, number, number];
  }

  const rgb = colour.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1]!
      .split(/[,/\s]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
      return [parts[0]!, parts[1]!, parts[2]!];
    }
  }

  return null;
}

/** Perceived brightness, 0 for black and 1 for white. */
function brightness(value: string) {
  const rgb = channels(value);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Does the message paint its own page?
 *
 * This is the line between a message that was designed — a newsletter with a
 * card on a tinted field, which has to keep the colours it chose — and the
 * far more common message that is a few paragraphs of text and inherits
 * whatever the client puts behind it.
 */
function declaresBackground(html: string) {
  if (/<[^>]+\sbgcolor\s*=\s*("|')?(?!transparent)[^\s"'>]+/i.test(html)) return true;

  for (const match of html.matchAll(/background(?:-color)?\s*:\s*([^;"']+)/gi)) {
    const value = match[1]!.trim().toLowerCase();
    if (value === "transparent" || value === "none" || value === "inherit") continue;
    if (value.startsWith("url(")) continue;
    if (channels(value.split(/\s+/)[0]!) || /^(linear|radial)-gradient/.test(value)) return true;
  }

  return false;
}

/**
 * Takes out the text colours that a dark page would swallow.
 *
 * A message that sets `color:#27272a` chose it against white, and left on a
 * dark page it renders near-black on near-black. Only the declarations too
 * dark to read are dropped, so a brand colour bright enough to survive keeps
 * the emphasis its author meant by it.
 */
function dropUnreadableColours(html: string) {
  let output = html.replace(
    /\sstyle\s*=\s*"([^"]*)"|\sstyle\s*=\s*'([^']*)'/gi,
    (match, double?: string, single?: string) => {
      const body = double ?? single ?? "";
      const kept = body
        .split(";")
        .filter((rule) => {
          const [property, ...rest] = rule.split(":");
          if (!property || rest.length === 0) return rule.trim().length > 0;
          if (property.trim().toLowerCase() !== "color") return true;
          const level = brightness(rest.join(":"));
          return level === null || level > 0.45;
        })
        .join(";");
      if (kept.trim() === body.trim()) return match;
      return kept.trim() ? ` style="${kept}"` : "";
    },
  );

  // <font color> and the colour attribute old templates still carry.
  output = output.replace(
    /\scolor\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, _raw, double?: string, single?: string, bare?: string) => {
      const level = brightness(double ?? single ?? bare ?? "");
      return level !== null && level <= 0.45 ? "" : match;
    },
  );

  return output;
}

/**
 * Splits a message into the part somebody wrote and the parts they quoted.
 *
 * A reply is two things in one document: a few lines of your own, and below
 * them somebody else's message carried along whole. They were written against
 * different pages and have to be treated separately — otherwise two lines of
 * "Thanks" inherit the styling of whatever newsletter they were sent under.
 *
 * Two shapes cover nearly all of it. A bare `<blockquote>` is the old
 * convention every client understands. Gmail wraps the quote and the "On
 * Tuesday, so-and-so wrote:" line above it together in one `gmail_quote`
 * container — so looking only for the blockquote leaves that line stranded
 * above the fold, pointing at nothing.
 */
function quotedRanges(html: string) {
  const ranges: { from: number; to: number }[] = [];

  const closingFor = (openTag: RegExp, closeTag: RegExp, from: number, openLength: number) => {
    // Walk the tags that nest, counting, until the one that closes this.
    const scan = new RegExp(`${openTag.source}|${closeTag.source}`, "gi");
    scan.lastIndex = from + openLength;
    let depth = 1;
    let hit = scan.exec(html);
    while (hit) {
      depth += hit[0].startsWith("</") ? -1 : 1;
      if (depth === 0) return hit.index + hit[0].length;
      hit = scan.exec(html);
    }
    return html.length;
  };

  const containers = /<div\b[^>]*class\s*=\s*["'][^"']*\bgmail_quote\b[^"']*["'][^>]*>/gi;
  let container = containers.exec(html);
  while (container) {
    const to = closingFor(/<div\b[^>]*>/, /<\/div\s*>/, container.index, container[0].length);
    ranges.push({ from: container.index, to });
    containers.lastIndex = to;
    container = containers.exec(html);
  }

  const quotes = /<blockquote\b[^>]*>/gi;
  let quote = quotes.exec(html);
  while (quote) {
    // One already inside a container is part of it, not a quote of its own.
    const inside = ranges.some((range) => quote!.index >= range.from && quote!.index < range.to);
    const to = closingFor(/<blockquote\b[^>]*>/, /<\/blockquote\s*>/, quote.index, quote[0].length);
    if (!inside) ranges.push({ from: quote.index, to });
    quotes.lastIndex = to;
    quote = quotes.exec(html);
  }

  return ranges.sort((a, b) => a.from - b.from);
}

function splitQuotes(html: string) {
  const parts: { quoted: boolean; text: string }[] = [];
  let at = 0;

  for (const range of quotedRanges(html)) {
    if (range.from < at) continue;
    if (range.from > at) parts.push({ quoted: false, text: html.slice(at, range.from) });
    parts.push({ quoted: true, text: html.slice(range.from, range.to) });
    at = range.to;
  }

  if (at < html.length) parts.push({ quoted: false, text: html.slice(at) });
  return parts;
}

/**
 * The line a mail client writes above a quote — "On Tuesday, Ada wrote:".
 *
 * It reads as part of the quote and should fold away with it. Matched only at
 * the very end of what came before, so a message that happens to contain the
 * word "wrote" keeps it.
 */
function takeAttribution(html: string) {
  const match = html.match(
    /(<(?:div|p|blockquote)[^>]*>|^|<br\s*\/?>)((?:(?!<(?:div|p)[^>]*>)[\s\S]){0,400}?wrote:\s*(?:<br\s*\/?>|<\/(?:div|p)>|\s)*)$/i,
  );
  if (!match) return null;

  const opening = match[1] ?? "";
  const start = match.index! + (opening === "^" ? 0 : opening.length);
  return {
    rest: html.slice(0, match.index!),
    attribution: html.slice(match.index!) === html ? html : opening + html.slice(start),
  };
}

export function prepareEmailHtml(
  html: string,
  options: { showRemoteImages: boolean; inlineImages?: Record<string, string>; dark?: boolean },
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

  /**
   * Counted whether or not they are blocked: once a reader has let them
   * through there is nothing left in the markup to say the message ever had
   * any, and without that there is nothing to offer to hide again.
   */
  const remoteImages =
    (output.match(/<img[^>]*\ssrc\s*=\s*["']https?:\/\//gi) ?? []).length +
    (output.match(/\ssrcset\s*=\s*["'][^"']*https?:\/\//gi) ?? []).length;

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

  const parts = splitQuotes(output);

  // Each part is judged on its own: a quoted newsletter keeps its colours
  // because it brought a page to put them on, while a plain quote is as
  // unreadable on a dark page as the reply above it would be.
  const dress = (text: string) =>
    options.dark && !declaresBackground(text) ? dropUnreadableColours(text) : text;

  const written: string[] = [];
  const quoted: string[] = [];

  for (const [index, part] of parts.entries()) {
    if (part.quoted) {
      // "On Tuesday, so-and-so wrote:" belongs to the quote it introduces.
      // Left behind it dangles over nothing once the quote is folded away.
      const previous = written.length - 1;
      if (previous >= 0 && index > 0) {
        const trimmed = takeAttribution(written[previous]!);
        if (trimmed) {
          written[previous] = trimmed.rest;
          quoted.push(trimmed.attribution);
        }
      }
      quoted.push(part.text);
    } else {
      written.push(part.text);
    }
  }

  /**
   * Whether the message paints its own page is asked of what the sender
   * actually wrote, not of what they quoted. A reply to a newsletter carries
   * that newsletter's background along with it, and answering yes there put a
   * lit slab behind two lines of "Thanks for the information".
   */
  const writtenHtml = written.map(dress).join("");
  const quotedHtml = quoted.length > 0 ? quoted.map(dress).join("") : null;

  return {
    html: writtenHtml,
    /** What this message carried along from the one it answers. */
    quoted: quotedHtml,
    quotedOwnsBackground: quotedHtml ? declaresBackground(quotedHtml) : false,
    blockedImages,
    /** How many the message carries, blocked or not. */
    remoteImages,
    ownsBackground: written.some((part) => declaresBackground(part)),
  };
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
