/**
 * The document a template is built from, and the email HTML it turns into.
 *
 * A builder needs something to build: a list of blocks, each small enough to
 * be described by a handful of fields and drawn by a form. The HTML is
 * derived, never edited — regenerated on every save, so what is on the canvas
 * and what goes out cannot drift apart.
 *
 * The output is deliberately old-fashioned: nested tables, widths as
 * attributes, every style inline. That is not nostalgia. Outlook renders mail
 * through Word, Gmail strips most of what is in the head, and neither has
 * ever been talked out of it, so the safe subset is the 1999 subset.
 */

import { escapeHtml } from "./template";

/* -------------------------------------------------------------------------- */
/* The document                                                               */
/* -------------------------------------------------------------------------- */

export type Align = "left" | "center" | "right";

/** Top, right, bottom, left — the order CSS says them in. */
export type Padding = [number, number, number, number];

export interface Border {
  width: number;
  color: string;
  radius: number;
}

/**
 * What any block can be told about itself.
 *
 * Every field is optional and every one of them falls back to the theme or to
 * the block's own sensible default, so a template built by clicking twice
 * looks designed, and one that somebody sat down with can be pushed around a
 * pixel at a time.
 */
export interface BlockStyle {
  color?: string;
  background?: string;
  /** Pixels. */
  fontSize?: number;
  /** Per cent, the way a designer says it: 155 means 1.55. */
  lineHeight?: number;
  letterSpacing?: number;
  /** 400 to 700. */
  weight?: number;
  padding?: Padding;
  border?: Border;
}

interface Common {
  id: string;
  style?: BlockStyle;
}

export interface HeadingBlock extends Common {
  type: "heading";
  text: string;
  /** 1 is a title, 3 is a section label. */
  level: 1 | 2 | 3;
  align: Align;
}

export interface TextBlock extends Common {
  type: "text";
  /** Inline markup from the small editor: bold, italic, links, lists. */
  html: string;
  align: Align;
}

export interface ButtonBlock extends Common {
  type: "button";
  text: string;
  href: string;
  align: Align;
  /** The button's own fill, which is not the block's background. */
  fill: string;
  radius: number;
  fullWidth: boolean;
}

export interface ImageBlock extends Common {
  type: "image";
  src: string;
  alt: string;
  href: string;
  align: Align;
  /** Per cent of the content width. */
  width: number;
  radius: number;
}

export interface DividerBlock extends Common {
  type: "divider";
  color: string;
  thickness: number;
}

export interface SpacerBlock extends Common {
  type: "spacer";
  /** Pixels of empty room. */
  size: number;
}

export interface ColumnsBlock extends Common {
  type: "columns";
  /** Two or three columns of copy, side by side. */
  columns: { html: string }[];
  /** Pixels between them. */
  gap: number;
}

export interface QuoteBlock extends Common {
  type: "quote";
  html: string;
  accent: string;
}

export interface CodeBlock extends Common {
  type: "code";
  code: string;
}

export interface YoutubeBlock extends Common {
  type: "youtube";
  /** A watch link, a short link, or the id on its own. */
  url: string;
  caption: string;
  align: Align;
  /** Per cent of the content width. */
  width: number;
  radius: number;
}

export interface TableBlock extends Common {
  type: "table";
  /** Row zero is the heading row when this is on. */
  header: boolean;
  rows: string[][];
  borderColor: string;
  headerBackground: string;
}

export interface SocialBlock extends Common {
  type: "social";
  links: { label: string; href: string }[];
  align: Align;
}

export interface FooterBlock extends Common {
  type: "footer";
  text: string;
  unsubscribeLabel: string;
  /** Usually a variable: the list's own one-click link. */
  unsubscribeHref: string;
  align: Align;
}

export interface HtmlBlock extends Common {
  type: "html";
  /** Passed through untouched. The escape hatch, and it is labelled as one. */
  html: string;
}

export type Block =
  | HeadingBlock
  | TextBlock
  | ButtonBlock
  | ImageBlock
  | DividerBlock
  | SpacerBlock
  | ColumnsBlock
  | QuoteBlock
  | CodeBlock
  | YoutubeBlock
  | TableBlock
  | SocialBlock
  | FooterBlock
  | HtmlBlock;

export type BlockKind = Block["type"];

export interface EmailTheme {
  /** Behind the card: the wall the email is hung on. */
  background: string;
  /** The card itself. */
  surface: string;
  text: string;
  link: string;
  /** Content width in pixels. 600 is the number every client agrees on. */
  width: number;
  font: string;
  /**
   * Rounded corners on the card. Off by default: Outlook squares them anyway,
   * so a rounded template is one that arrives looking like two templates.
   */
  radius: number;
}

export interface EmailDesign {
  /** Bumped only if the shape changes in a way old rows cannot be read as. */
  version: 1;
  theme: EmailTheme;
  blocks: Block[];
}

export const FONTS: { label: string; value: string }[] = [
  { label: "System", value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { label: "Courier", value: "'Courier New', Courier, monospace" },
];

export const DEFAULT_THEME: EmailTheme = {
  background: "#f4f4f5",
  surface: "#ffffff",
  text: "#18181b",
  link: "#4f46e5",
  width: 600,
  font: FONTS[0]!.value,
  radius: 0,
};

export function emptyDesign(): EmailDesign {
  return { version: 1, theme: { ...DEFAULT_THEME }, blocks: [] };
}

/** Room either side of the content, so text never touches the card's edge. */
const GUTTER = 32;

/** What a block is padded by before anybody changes it. */
function defaultPadding(kind: BlockKind): Padding {
  switch (kind) {
    case "spacer":
      return [0, 0, 0, 0];
    // An image arrives wanting to be the full width of the card — a hero, a
    // header, a screenshot. Gutters on it by default means every one of them
    // starts by being told to stop having gutters.
    case "image":
      return [0, 0, 0, 0];
    case "divider":
      return [8, GUTTER, 22, GUTTER];
    case "footer":
      return [20, GUTTER, 24, GUTTER];
    default:
      return [0, GUTTER, 16, GUTTER];
  }
}

/** A new block of a kind, with the settings somebody would have typed anyway. */
export function newBlock(kind: BlockKind, id: string): Block {
  const style: BlockStyle = { padding: defaultPadding(kind) };

  switch (kind) {
    case "heading":
      return { id, type: "heading", text: "Heading", level: 2, align: "left", style };
    case "text":
      return { id, type: "text", html: "Write something here.", align: "left", style };
    case "button":
      return {
        id,
        type: "button",
        text: "Click me",
        href: "https://example.com",
        align: "left",
        fill: DEFAULT_THEME.link,
        radius: 8,
        fullWidth: false,
        style: { ...style, color: "#ffffff" },
      };
    case "image":
      return {
        id,
        type: "image",
        src: "",
        alt: "",
        href: "",
        align: "center",
        width: 100,
        radius: 0,
        style,
      };
    case "divider":
      return { id, type: "divider", color: "#e4e4e7", thickness: 1, style };
    case "spacer":
      return { id, type: "spacer", size: 24, style };
    case "columns":
      return {
        id,
        type: "columns",
        columns: [{ html: "Left column." }, { html: "Right column." }],
        gap: 20,
        style,
      };
    case "quote":
      return {
        id,
        type: "quote",
        html: "Something worth repeating.",
        accent: DEFAULT_THEME.link,
        style,
      };
    case "code":
      return { id, type: "code", code: "npm install mailroom", style };
    case "youtube":
      return {
        id,
        type: "youtube",
        url: "",
        caption: "Watch on YouTube",
        align: "center",
        width: 100,
        radius: 8,
        style,
      };
    case "table":
      return {
        id,
        type: "table",
        header: true,
        rows: [
          ["Item", "Price"],
          ["One", "$10"],
          ["Two", "$20"],
        ],
        borderColor: "#e4e4e7",
        headerBackground: "#f4f4f5",
        style,
      };
    case "social":
      return {
        id,
        type: "social",
        align: "center",
        links: [
          { label: "Website", href: "https://example.com" },
          { label: "X", href: "https://x.com" },
        ],
        style,
      };
    case "footer":
      return {
        id,
        type: "footer",
        text: "You are getting this because you signed up.",
        unsubscribeLabel: "Unsubscribe",
        unsubscribeHref: "{{ unsubscribe_url }}",
        align: "center",
        style: { ...style, fontSize: 12, color: "#71717a" },
      };
    case "html":
      return { id, type: "html", html: "<!-- your HTML here -->", style };
  }
}

/**
 * Reads a stored design back, refusing anything it does not recognise.
 *
 * The column is JSON, so it can hold whatever an older or newer version of
 * this file wrote. Rather than trust it, every block is checked and anything
 * unknown is dropped: a template that lost a block added in a later release
 * is recoverable, and one that renders `[object Object]` into a customer's
 * inbox is not.
 */
export function readDesign(value: unknown): EmailDesign | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<EmailDesign>;
  if (!Array.isArray(raw.blocks)) return null;

  const theme = { ...DEFAULT_THEME, ...(raw.theme ?? {}) };
  return { version: 1, theme, blocks: raw.blocks.filter(isBlock) };
}

const KINDS: BlockKind[] = [
  "heading",
  "text",
  "button",
  "image",
  "divider",
  "spacer",
  "columns",
  "quote",
  "code",
  "youtube",
  "table",
  "social",
  "footer",
  "html",
];

function isBlock(value: unknown): value is Block {
  if (!value || typeof value !== "object") return false;
  const block = value as Block;
  return typeof block.id === "string" && KINDS.includes(block.type);
}

/**
 * The video id out of whatever somebody pasted.
 *
 * A watch link, a short link, an embed link, or the id on its own — all four
 * turn up, and asking which one you have is a question with no good answer.
 */
export function youtubeId(url: string): string | null {
  const value = url.trim();
  if (!value) return null;

  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/(?:embed|shorts|live)\/)([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const found = pattern.exec(value)?.[1];
    if (found) return found;
  }

  return /^[\w-]{11}$/.test(value) ? value : null;
}

/** Where the picture of a video lives. */
export function youtubeThumb(id: string) {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

export function youtubeWatch(id: string) {
  return `https://www.youtube.com/watch?v=${id}`;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/** The size and weight a heading level starts at. */
export const HEADING_DEFAULTS: Record<1 | 2 | 3, { size: number; weight: number }> = {
  1: { size: 30, weight: 700 },
  2: { size: 22, weight: 600 },
  3: { size: 17, weight: 600 },
};

export function renderDesign(design: EmailDesign): string {
  const theme = design.theme;
  const body = design.blocks.map((block) => renderBlock(block, theme)).join("\n");

  // Columns stack on a phone. Gmail and Apple Mail honour this; the ones that
  // do not simply keep the columns side by side, which is what they did
  // before there was a media query at all.
  const stacking =
    "@media only screen and (max-width:600px){.mr-col{display:block !important;width:100% !important;padding-left:0 !important;padding-right:0 !important;}}";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title></title>
<style>${stacking}</style>
</head>
<body style="margin:0;padding:0;background-color:${attr(theme.background)};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${attr(theme.background)};">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="${theme.width}" cellpadding="0" cellspacing="0" border="0" style="width:${theme.width}px;max-width:100%;background-color:${attr(theme.surface)};border-radius:${theme.radius}px;">
${body}
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

/** The cell a block sits in: its padding, its background and its border. */
function cell(block: Block, content: string) {
  const style = block.style ?? {};
  const padding = style.padding ?? defaultPadding(block.type);
  const rules = [`padding:${padding.map((value) => `${clamp(value, 0, 200)}px`).join(" ")}`];

  if (style.background) rules.push(`background-color:${attr(style.background)}`);
  if (style.border && style.border.width > 0) {
    rules.push(`border:${clamp(style.border.width, 0, 20)}px solid ${attr(style.border.color)}`);
    if (style.border.radius > 0) rules.push(`border-radius:${clamp(style.border.radius, 0, 40)}px`);
  }

  return `<tr><td style="${rules.join(";")};">${content}</td></tr>`;
}

/** The text rules a block's own copy is drawn with. */
function typography(block: Block, theme: EmailTheme, fallback: { size: number; weight: number }) {
  const style = block.style ?? {};
  const rules = [
    `font-family:${attr(theme.font)}`,
    `font-size:${clamp(style.fontSize ?? fallback.size, 8, 72)}px`,
    `line-height:${clamp(style.lineHeight ?? 155, 90, 300) / 100}`,
    `font-weight:${style.weight ?? fallback.weight}`,
    `color:${attr(style.color ?? theme.text)}`,
  ];
  if (style.letterSpacing) rules.push(`letter-spacing:${style.letterSpacing}px`);
  return rules.join(";");
}

function renderBlock(block: Block, theme: EmailTheme): string {
  switch (block.type) {
    case "heading": {
      const fallback = HEADING_DEFAULTS[block.level] ?? HEADING_DEFAULTS[2];
      return cell(
        block,
        `<h${block.level} style="margin:0;${typography(block, theme, fallback)};text-align:${block.align};">${escapeHtml(block.text)}</h${block.level}>`,
      );
    }

    case "text":
      return cell(
        block,
        `<div style="${typography(block, theme, { size: 15, weight: 400 })};text-align:${block.align};">${inline(block.html, theme.link)}</div>`,
      );

    case "button": {
      // A table rather than a styled anchor: Outlook gives an <a> no padding,
      // so a button built that way arrives as underlined text.
      const width = block.fullWidth ? ' width="100%"' : "";
      const display = block.fullWidth ? "block" : "inline-block";
      return cell(
        block,
        `<table role="presentation"${width} cellpadding="0" cellspacing="0" border="0" align="${block.align}">
<tr><td align="center" bgcolor="${attr(block.fill)}" style="border-radius:${clamp(block.radius, 0, 40)}px;">
<a href="${attr(block.href)}" style="display:${display};padding:12px 22px;${typography(block, theme, { size: 15, weight: 600 })};color:${attr(block.style?.color ?? "#ffffff")};text-decoration:none;border-radius:${clamp(block.radius, 0, 40)}px;">${escapeHtml(block.text)}</a>
</td></tr>
</table>`,
      );
    }

    case "image": {
      if (!block.src) return "";
      const padding = block.style?.padding ?? defaultPadding("image");
      const room = theme.width - padding[1] - padding[3];
      const width = Math.round((room * clamp(block.width, 10, 100)) / 100);
      const radius = block.radius > 0 ? `border-radius:${clamp(block.radius, 0, 40)}px;` : "";
      const image = `<img src="${attr(block.src)}" alt="${attr(block.alt)}" width="${width}" style="display:block;width:${width}px;max-width:100%;height:auto;${radius}border:0;outline:none;text-decoration:none;">`;
      const wrapped = block.href
        ? `<a href="${attr(block.href)}" style="text-decoration:none;">${image}</a>`
        : image;
      return cell(
        block,
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${block.align}"><tr><td>${wrapped}</td></tr></table>`,
      );
    }

    case "divider":
      return cell(
        block,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:${clamp(block.thickness, 1, 12)}px solid ${attr(block.color)};font-size:0;line-height:0;">&nbsp;</td></tr></table>`,
      );

    case "spacer":
      // A cell with a height and a non-breaking space: an empty cell is
      // collapsed by some clients and the gap disappears.
      return `<tr><td style="height:${clamp(block.size, 1, 200)}px;line-height:${clamp(block.size, 1, 200)}px;font-size:0;">&nbsp;</td></tr>`;

    case "columns": {
      const count = Math.max(1, block.columns.length);
      const share = Math.floor(100 / count);
      const half = Math.round(clamp(block.gap, 0, 64) / 2);
      const cells = block.columns
        .map(
          (column) =>
            `<td class="mr-col" width="${share}%" valign="top" style="width:${share}%;padding:0 ${half}px;${typography(block, theme, { size: 15, weight: 400 })};">${inline(column.html, theme.link)}</td>`,
        )
        .join("");
      return cell(
        block,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`,
      );
    }

    case "quote":
      return cell(
        block,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:3px solid ${attr(block.accent)};padding:2px 0 2px 14px;${typography(block, theme, { size: 15, weight: 400 })};font-style:italic;">${inline(block.html, theme.link)}</td></tr></table>`,
      );

    case "code":
      return cell(
        block,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:#f4f4f5;border-radius:8px;padding:12px 14px;font-family:'Courier New',Courier,monospace;font-size:13px;line-height:1.5;color:#18181b;"><pre style="margin:0;white-space:pre-wrap;">${escapeHtml(block.code)}</pre></td></tr></table>`,
      );

    case "youtube": {
      // Nothing plays inside an email — every client strips iframes and
      // script — so what goes out is the thumbnail, linked to the video.
      // A fake play button drawn over it would be a lie about what happens
      // when it is pressed; the caption says where the link goes instead.
      const id = youtubeId(block.url);
      if (!id) return "";

      const padding = block.style?.padding ?? defaultPadding("youtube");
      const room = theme.width - padding[1] - padding[3];
      const width = Math.round((room * clamp(block.width, 10, 100)) / 100);
      const radius = block.radius > 0 ? `border-radius:${clamp(block.radius, 0, 40)}px;` : "";
      const caption = block.caption
        ? `<div style="${typography(block, theme, { size: 13, weight: 500 })};text-align:${block.align};padding-top:8px;">${escapeHtml(block.caption)}</div>`
        : "";

      return cell(
        block,
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${block.align}"><tr><td>
<a href="${attr(youtubeWatch(id))}" style="text-decoration:none;"><img src="${attr(youtubeThumb(id))}" alt="${attr(block.caption || "Watch the video")}" width="${width}" style="display:block;width:${width}px;max-width:100%;height:auto;${radius}border:0;outline:none;text-decoration:none;"></a>
${caption}
</td></tr></table>`,
      );
    }

    case "table": {
      const rules = `border:1px solid ${attr(block.borderColor)};padding:8px 10px;`;
      const body = block.rows
        .map((row, index) => {
          const heading = block.header && index === 0;
          const cells = row
            .map((value) =>
              heading
                ? `<th align="left" bgcolor="${attr(block.headerBackground)}" style="${rules}font-weight:600;">${escapeHtml(value)}</th>`
                : `<td style="${rules}">${escapeHtml(value)}</td>`,
            )
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");

      return cell(
        block,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${typography(block, theme, { size: 14, weight: 400 })};">${body}</table>`,
      );
    }

    case "social": {
      const links = block.links
        .filter((link) => link.label)
        .map(
          (link) =>
            `<a href="${attr(link.href)}" style="display:inline-block;margin:0 8px;color:${attr(block.style?.color ?? theme.link)};text-decoration:none;">${escapeHtml(link.label)}</a>`,
        )
        .join("");
      return cell(
        block,
        `<div style="${typography(block, theme, { size: 13, weight: 500 })};text-align:${block.align};">${links}</div>`,
      );
    }

    case "footer": {
      const link = block.unsubscribeHref
        ? `<a href="${attr(block.unsubscribeHref)}" style="color:${attr(block.style?.color ?? "#71717a")};text-decoration:underline;">${escapeHtml(block.unsubscribeLabel)}</a>`
        : "";
      return cell(
        block,
        `<div style="${typography(block, theme, { size: 12, weight: 400 })};text-align:${block.align};">${escapeHtml(block.text)}${link ? `<br>${link}` : ""}</div>`,
      );
    }

    case "html":
      // Untouched on purpose. Whoever typed it owns what it does.
      return cell(block, block.html);
  }
}

/**
 * The plain-text half, from the same blocks.
 *
 * Every send should carry one: a message with no text part looks like spam to
 * filters that check, and it is the only thing a screen reader in a text
 * client has to read.
 */
export function designToText(design: EmailDesign): string {
  const parts: string[] = [];

  for (const block of design.blocks) {
    switch (block.type) {
      case "heading":
        parts.push(block.text);
        break;
      case "text":
      case "quote":
        parts.push(stripTags(block.html));
        break;
      case "code":
        parts.push(block.code);
        break;
      case "columns":
        for (const column of block.columns) parts.push(stripTags(column.html));
        break;
      case "button":
        parts.push(block.href ? `${block.text}: ${block.href}` : block.text);
        break;
      case "image":
        if (block.alt) parts.push(`[${block.alt}]`);
        break;
      case "youtube": {
        const id = youtubeId(block.url);
        if (id) parts.push(`${block.caption || "Watch the video"}: ${youtubeWatch(id)}`);
        break;
      }
      case "table":
        parts.push(block.rows.map((row) => row.join(" | ")).join("\n"));
        break;
      case "social":
        parts.push(block.links.map((link) => `${link.label}: ${link.href}`).join("\n"));
        break;
      case "footer":
        parts.push(
          block.unsubscribeHref
            ? `${block.text}\n${block.unsubscribeLabel}: ${block.unsubscribeHref}`
            : block.text,
        );
        break;
      case "html":
        parts.push(stripTags(block.html));
        break;
      case "divider":
        parts.push("—".repeat(24));
        break;
      case "spacer":
        break;
    }
  }

  return parts
    .filter((part) => part.trim())
    .join("\n\n")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Cleaning what the editor produced                                          */
/* -------------------------------------------------------------------------- */

/** Everything a paragraph of email copy is allowed to contain. */
const INLINE_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "br",
  "a",
  "ul",
  "ol",
  "li",
  "p",
  "span",
  "blockquote",
]);

/**
 * The text blocks are edited in a contenteditable, which means the browser
 * decides the markup and a paste can bring anything with it. Only the tags
 * above survive, links keep an http(s), mailto or variable address and
 * nothing else, and every other attribute is dropped — including the event
 * handlers that are the reason this function exists.
 */
export function inline(html: string, linkColor: string): string {
  // A stack, because a tag rewritten on the way in has to be closed by what
  // it became: an <a> pointing somewhere nobody should follow becomes a
  // <span>, and its </a> has to become </span> or the result is not markup.
  const open: string[] = [];

  return html.replace(
    /<(\/?)([a-zA-Z0-9]+)([^>]*)>/g,
    (_whole, slash: string, name: string, rest: string) => {
      const tag = name.toLowerCase();
      if (!INLINE_TAGS.has(tag)) return "";

      if (slash) {
        const opened = open.pop();
        return opened ? `</${opened}>` : "";
      }

      if (tag === "br") return "<br>";

      if (tag === "a") {
        const href = /href\s*=\s*["']([^"']*)["']/i.exec(rest)?.[1] ?? "";
        if (!safeHref(href)) {
          open.push("span");
          return "<span>";
        }
        open.push("a");
        return `<a href="${attr(href)}" style="color:${attr(linkColor)};text-decoration:underline;">`;
      }

      open.push(tag);
      return `<${tag}>`;
    },
  );
}

function safeHref(href: string) {
  return /^(https?:|mailto:|tel:|\{\{)/i.test(href.trim());
}

function stripTags(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A value going inside a quoted attribute. */
function attr(value: string) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function clamp(value: number, low: number, high: number) {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, Math.round(value)));
}
