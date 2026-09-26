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
  /**
   * Which screens this block is left out of.
   *
   * A media query does the hiding, and Outlook has none, so it shows whatever
   * a desktop would have seen. That is the right way round: "mobile only" is
   * usually an extra, and "desktop only" is usually the wide thing a phone
   * was meant to do without.
   */
  hideOn?: "mobile" | "desktop";
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
  /**
   * What is in each column. Blocks, not copy: a column with a picture and a
   * button under it is the reason anybody reaches for columns at all.
   *
   * One level deep. Columns inside columns is a layout engine, and an email
   * that needs one is an email that will arrive differently everywhere.
   */
  columns: { blocks: Block[] }[];
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
  /** A play badge over the thumbnail, so it reads as a video. */
  playButton: boolean;
}

export interface TableBlock extends Common {
  type: "table";
  /** Row zero is the heading row when this is on. */
  header: boolean;
  rows: string[][];
  borderColor: string;
  headerBackground: string;
}

/**
 * The networks a footer can point at.
 *
 * A fixed list rather than free text, because each one carries an icon and an
 * icon has to have been drawn. "Website" and "Email" are here for the two
 * links every footer has that are not a network at all.
 */
export const NETWORKS = [
  { key: "x", label: "X" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "youtube", label: "YouTube" },
  { key: "github", label: "GitHub" },
  { key: "twitch", label: "Twitch" },
  { key: "slack", label: "Slack" },
  { key: "dribbble", label: "Dribbble" },
  { key: "figma", label: "Figma" },
  { key: "rss", label: "RSS" },
  { key: "website", label: "Website" },
  { key: "email", label: "Email" },
] as const;

export type Network = (typeof NETWORKS)[number]["key"];

export function networkLabel(network: Network) {
  return NETWORKS.find((entry) => entry.key === network)?.label ?? "Link";
}

/** Where an icon lives. Absolute in a real send; relative on screen. */
export function networkIcon(network: Network, tone: "dark" | "light", origin = "") {
  return `${origin}/social/${network}-${tone}.png`;
}

/** What a pasted address is, when it says so itself. */
export function networkOf(href: string): Network | null {
  const value = href.toLowerCase();
  if (value.startsWith("mailto:")) return "email";
  for (const { key } of NETWORKS) {
    if (key === "website" || key === "email") continue;
    if (value.includes(`${key}.com`)) return key;
  }
  if (value.includes("twitter.com") || value.includes("x.com")) return "x";
  if (value.includes("youtu.be")) return "youtube";
  return null;
}

export interface SocialBlock extends Common {
  type: "social";
  links: { network: Network; href: string }[];
  align: Align;
  /** Dark icons on a light email, light icons on a dark one. */
  tone: "dark" | "light";
  /** Pixels across. */
  size: number;
}

export interface FooterBlock extends Common {
  type: "footer";
  text: string;
  unsubscribeLabel: string;
  /** Usually a variable: the list's own one-click link. */
  unsubscribeHref: string;
  align: Align;
}

/**
 * A bulleted or numbered list.
 *
 * Its own block rather than something to type into a text block, because the
 * indent, the marker and the space between items are three things that have
 * to survive Outlook, and asking somebody to get them right by hand in a rich
 * editor is asking them to find out in an inbox that they did not.
 */
export interface ListBlock extends Common {
  type: "list";
  items: string[];
  ordered: boolean;
  /** The marker for an unordered list. A dot, a dash, a tick, an arrow. */
  marker: string;
  /** Pixels between one item and the next. */
  gap: number;
}

/**
 * A boxed notice: a tip, a warning, the one paragraph that matters.
 *
 * People build these out of a one-cell table today, which means the padding
 * and the border are retyped every time and no two of them match.
 */
export interface CalloutBlock extends Common {
  type: "callout";
  html: string;
  /**
   * The colour of the box.
   *
   * Its own field rather than `style.background`, which every block has and
   * which paints the whole row it sits in. Using that one tinted the full
   * width of the email instead of the notice, which is the opposite of what a
   * callout is for.
   */
  tint: string;
  /** The stripe down the side. Empty turns it off. */
  accent: string;
  /** An emoji, or empty for none. Not an image: it has to survive a blocker. */
  icon: string;
  align: Align;
}

/**
 * One or more big numbers with a word under each.
 *
 * The shape every product update and every year-in-review is made of. Laid
 * out as a row that Outlook can draw, which a flexbox cannot be.
 */
export interface StatBlock extends Common {
  type: "stat";
  items: { value: string; label: string }[];
  align: Align;
  /** Pixels. The number is the point, so it is large by default. */
  valueSize: number;
  valueColor: string;
}

/**
 * The row of links across the top of a newsletter.
 *
 * Text rather than images, so it is readable before anybody agrees to load a
 * picture — which most readers never do.
 */
export interface MenuBlock extends Common {
  type: "menu";
  links: { label: string; href: string }[];
  align: Align;
  /** What sits between two links. A bullet, a pipe, a space. */
  separator: string;
}

/**
 * Two, three or four pictures in a row.
 *
 * Built as a table so it survives Outlook, and each picture is sized in the
 * markup rather than by CSS, because a width in a style attribute is the
 * first thing Word throws away.
 */
export interface GalleryBlock extends Common {
  type: "gallery";
  images: { src: string; alt: string; href: string }[];
  /** 2, 3 or 4. More than four and nothing is legible on a phone. */
  perRow: number;
  gap: number;
  radius: number;
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
  | ListBlock
  | CalloutBlock
  | StatBlock
  | MenuBlock
  | GalleryBlock
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
  /**
   * Where this instance answers. Set while rendering rather than saved: the
   * address can change, and the pictures in an email have to be fetched from
   * wherever it answers today.
   */
  origin?: string;
}

export interface EmailDesign {
  /** Bumped only if the shape changes in a way old rows cannot be read as. */
  version: 1;
  theme: EmailTheme;
  blocks: Block[];
  /**
   * The grey line an inbox prints after the subject.
   *
   * Left out, every client picks the first words of the body itself, which is
   * how "View this email in your browser" ends up being the summary of a
   * newsletter. It is a property of the message rather than of its look, but
   * it is written where the rest of the message is written.
   */
  preheader?: string;
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
    case "footer":
      return [20, GUTTER, 20, GUTTER];
    default:
      return [8, GUTTER, 8, GUTTER];
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
        columns: [{ blocks: [] }, { blocks: [] }],
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
        playButton: true,
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
        tone: "dark",
        size: 24,
        links: [
          { network: "x", href: "https://x.com/" },
          { network: "instagram", href: "https://instagram.com/" },
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
    case "list":
      return {
        id,
        type: "list",
        items: ["The first thing", "The second thing", "The third thing"],
        ordered: false,
        marker: "\u2022",
        gap: 8,
        style,
      };
    case "callout":
      return {
        id,
        type: "callout",
        html: "Worth knowing before you read the rest.",
        // Transparent, like every other block. A notice reads as one from
        // its stripe; a tint is a choice, not something to arrive with.
        tint: "",
        accent: DEFAULT_THEME.link,
        icon: "",
        align: "left",
        style,
      };
    case "stat":
      return {
        id,
        type: "stat",
        items: [
          { value: "1,204", label: "Subscribers" },
          { value: "48%", label: "Opened" },
          { value: "12", label: "Campaigns" },
        ],
        align: "center",
        valueSize: 30,
        valueColor: DEFAULT_THEME.text,
        style,
      };
    case "menu":
      return {
        id,
        type: "menu",
        links: [
          { label: "Home", href: "https://example.com" },
          { label: "Blog", href: "https://example.com/blog" },
          { label: "Contact", href: "https://example.com/contact" },
        ],
        align: "center",
        separator: "\u00b7",
        style: { ...style, fontSize: 13 },
      };
    case "gallery":
      return {
        id,
        type: "gallery",
        images: [
          { src: "", alt: "", href: "" },
          { src: "", alt: "", href: "" },
        ],
        perRow: 2,
        gap: 12,
        radius: 8,
        style,
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
  const blocks = raw.blocks
    .map((entry) => readBlock(entry))
    .filter((entry): entry is Block => entry !== null);

  const preheader = typeof raw.preheader === "string" ? raw.preheader.slice(0, 200) : undefined;

  return { version: 1, theme, blocks, preheader };
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
  "list",
  "callout",
  "stat",
  "menu",
  "gallery",
  "html",
];

function isBlock(value: unknown): value is Block {
  if (!value || typeof value !== "object") return false;
  const block = value as Block;
  return typeof block.id === "string" && KINDS.includes(block.type);
}

/**
 * A block as this release understands it.
 *
 * Columns used to hold one lump of copy each and now hold blocks, so an older
 * design is read forward: the copy it had becomes the text block it always
 * meant. Anything nested deeper than one level is flattened away, because
 * that is all the renderer draws.
 */
function readBlock(value: unknown, depth = 0): Block | null {
  if (!isBlock(value)) return null;

  // Social links were labels with addresses before they were networks with
  // icons. The address usually says which network it is; the ones that do not
  // become a plain website link, which is what they were being used as.
  if (value.type === "social") {
    return {
      ...value,
      tone: value.tone ?? "dark",
      size: value.size ?? 24,
      links: (value.links ?? []).map((link) => {
        const legacy = link as unknown as { label?: string; network?: Network; href: string };
        if (legacy.network) return { network: legacy.network, href: legacy.href };
        return { network: networkOf(legacy.href) ?? "website", href: legacy.href };
      }),
    };
  }

  // A callout painted its box with `style.background` before it had a tint of
  // its own. That colour was meant for the box, so it moves there, and the
  // row stops being painted edge to edge.
  if (value.type === "callout" && typeof value.tint !== "string") {
    const { background, ...style } = value.style ?? {};
    return {
      ...value,
      tint: typeof background === "string" ? background : "",
      accent: value.accent ?? "",
      icon: value.icon ?? "",
      style,
    };
  }

  if (value.type !== "columns") return value;
  if (depth > 0) return null;

  const columns = (value.columns ?? []).map((column, index) => {
    const legacy = (column as unknown as { html?: string }).html;
    if (typeof legacy === "string") {
      return { blocks: [{ ...newBlock("text", `${value.id}-c${index}`), html: legacy } as Block] };
    }
    return {
      blocks: (column.blocks ?? [])
        .map((entry) => readBlock(entry, depth + 1))
        .filter((entry): entry is Block => entry !== null),
    };
  });

  return { ...value, columns };
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
/* Where a block is                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Blocks live in one of two places: the document, or a column of one.
 *
 * Everything the builder does to a block — change it, move it, copy it, throw
 * it away — has to work in both, so the walking is here, once, rather than in
 * the screen in two slightly different versions.
 */
export interface Where {
  /** The columns block it is inside, if it is inside one. */
  parentId?: string;
  /** Which column of that block. */
  column?: number;
}

/** Every block, wherever it is, including the ones inside columns. */
export function everyBlock(blocks: Block[]): Block[] {
  return blocks.flatMap((block) =>
    block.type === "columns"
      ? [block, ...block.columns.flatMap((column) => column.blocks)]
      : [block],
  );
}

export function findBlock(blocks: Block[], id: string): Block | null {
  return everyBlock(blocks).find((block) => block.id === id) ?? null;
}

/** Which column of which block something is in, or nothing if it is loose. */
export function whereIs(blocks: Block[], id: string): Where {
  for (const block of blocks) {
    if (block.type !== "columns") continue;
    const column = block.columns.findIndex((entry) =>
      entry.blocks.some((child) => child.id === id),
    );
    if (column >= 0) return { parentId: block.id, column };
  }
  return {};
}

/** The list a block belongs to, wherever it is. */
function listOf(blocks: Block[], where: Where): Block[] {
  if (!where.parentId) return blocks;
  const parent = blocks.find((block) => block.id === where.parentId);
  if (parent?.type !== "columns") return [];
  return parent.columns[where.column ?? 0]?.blocks ?? [];
}

/** The same document with one list replaced. */
function withList(blocks: Block[], where: Where, next: Block[]): Block[] {
  if (!where.parentId) return next;
  return blocks.map((block) =>
    block.id === where.parentId && block.type === "columns"
      ? {
          ...block,
          columns: block.columns.map((column, index) =>
            index === (where.column ?? 0) ? { blocks: next } : column,
          ),
        }
      : block,
  );
}

/** Changes one block, wherever it is. */
export function patchBlock(blocks: Block[], id: string, changes: Partial<Block>): Block[] {
  return blocks.map((block) => {
    if (block.id === id) return { ...block, ...changes } as Block;
    if (block.type !== "columns") return block;
    return {
      ...block,
      columns: block.columns.map((column) => ({
        blocks: column.blocks.map((child) =>
          child.id === id ? ({ ...child, ...changes } as Block) : child,
        ),
      })),
    };
  });
}

export function removeBlock(blocks: Block[], id: string): Block[] {
  return blocks
    .filter((block) => block.id !== id)
    .map((block) =>
      block.type === "columns"
        ? {
            ...block,
            columns: block.columns.map((column) => ({
              blocks: column.blocks.filter((child) => child.id !== id),
            })),
          }
        : block,
    );
}

/** Puts a block in, at a position, in the document or in a column. */
export function insertBlock(blocks: Block[], block: Block, where: Where, at: number): Block[] {
  const list = [...listOf(blocks, where)];
  list.splice(Math.min(Math.max(at, 0), list.length), 0, block);
  return withList(blocks, where, list);
}

/** Moves a block up or down among its own neighbours. */
export function nudgeBlock(blocks: Block[], id: string, by: number): Block[] {
  const where = whereIs(blocks, id);
  const list = [...listOf(blocks, where)];
  const index = list.findIndex((block) => block.id === id);
  const next = index + by;
  if (index < 0 || next < 0 || next >= list.length) return blocks;

  const [moved] = list.splice(index, 1);
  list.splice(next, 0, moved!);
  return withList(blocks, where, list);
}

/** Takes a block out of wherever it is and puts it somewhere else. */
export function relocateBlock(blocks: Block[], id: string, to: Where, at: number): Block[] {
  const block = findBlock(blocks, id);
  if (!block) return blocks;
  // A columns block cannot go inside a column: one level deep is all the
  // renderer draws, and all an email client can be relied on to lay out.
  if (block.type === "columns" && to.parentId) return blocks;

  const from = whereIs(blocks, id);
  const sameList = from.parentId === to.parentId && from.column === to.column;
  const before = listOf(blocks, from).findIndex((entry) => entry.id === id);

  const without = removeBlock(blocks, id);
  // Taking it out shifts everything after it up by one.
  const target = sameList && before >= 0 && before < at ? at - 1 : at;
  return insertBlock(without, block, to, target);
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

/**
 * @param origin Where this instance answers, so the pictures it serves have
 *   an address a mail client can reach. Left out on screen, where the page it
 *   is drawn in supplies one.
 */
export function renderDesign(design: EmailDesign, origin = ""): string {
  const theme = { ...design.theme, origin };
  const body = design.blocks.map((block) => renderBlock(block, theme)).join("\n");

  /*
   * The one media query, at the width the email itself is: anything narrower
   * than the card is a screen the card does not fit on.
   *
   * Columns stack. Blocks marked for one size of screen appear or disappear.
   * Gmail and Apple Mail honour all of it; the clients that do not keep the
   * columns side by side and show every block, which is what they did before
   * there was a media query at all.
   */
  const small = clamp(theme.width, 320, 900);
  const stacking = [
    `@media only screen and (max-width:${small}px){`,
    ".mr-col{display:block !important;width:100% !important;padding-left:0 !important;padding-right:0 !important;}",
    ".mr-no-sm{display:none !important;max-height:0 !important;overflow:hidden !important;}",
    ".mr-only-sm{display:table-row !important;max-height:none !important;overflow:visible !important;}",
    "}",
  ].join("");

  /*
   * The preheader, and then a run of invisible characters.
   *
   * Without the padding the client keeps reading past the line and pulls the
   * first sentence of the body in after it, so the summary is half of what
   * was written here and half of something else. Zero-width joiners and
   * non-breaking spaces fill the rest of the space the inbox has for it.
   */
  const preheader = design.preheader?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${attr(theme.surface)};opacity:0;">${escapeHtml(design.preheader.trim())}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title></title>
<style>${stacking}</style>
</head>
<body style="margin:0;padding:0;background-color:${attr(theme.background)};">
${preheader}
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

  /*
   * Hiding is done to the row rather than to what is in it, so nothing is
   * left holding padding open where the block used to be. Outlook is told
   * separately, because it reads no media query and would otherwise show the
   * mobile-only half of a pair as well as the desktop one.
   */
  const screens =
    block.hideOn === "mobile"
      ? ' class="mr-no-sm"'
      : block.hideOn === "desktop"
        ? ' class="mr-only-sm" style="display:none;mso-hide:all;"'
        : "";

  return `<tr${screens}><td style="${rules.join(";")};">${content}</td></tr>`;
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
      /*
       * Each column is a table of its own, so the blocks inside one are laid
       * out by exactly the code that lays out the blocks outside it. The
       * width the inner blocks think they have is narrower, which matters to
       * anything sized against it — a picture, mostly — so it is passed down.
       */
      const inner = { ...theme, width: Math.floor(theme.width / count) - block.gap };

      const cells = block.columns
        .map((column) => {
          const body = column.blocks.map((entry) => renderBlock(entry, inner)).join("");
          return `<td class="mr-col" width="${share}%" valign="top" style="width:${share}%;padding:0 ${half}px;${typography(block, theme, { size: 15, weight: 400 })};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body || "<tr><td></td></tr>"}</table></td>`;
        })
        .join("");
      return cell(
        block,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`,
      );
    }

    case "list": {
      /*
       * A table with a cell per marker, not a <ul>.
       *
       * Outlook's list indentation is its own invention and cannot be
       * overridden, so a bulleted list built the correct way arrives with a
       * margin nobody asked for. A marker in its own narrow cell arrives the
       * same everywhere.
       */
      const rows = block.items
        .map((item, index) => {
          const marker = block.ordered ? `${index + 1}.` : block.marker || "\u2022";
          const space = index === block.items.length - 1 ? 0 : clamp(block.gap, 0, 40);
          return `<tr><td valign="top" width="24" style="width:24px;padding:0 0 ${space}px;${typography(block, theme, { size: 15, weight: 400 })};">${escapeHtml(marker)}</td><td valign="top" style="padding:0 0 ${space}px;${typography(block, theme, { size: 15, weight: 400 })};">${inline(item, theme.link)}</td></tr>`;
        })
        .join("");
      return cell(
        block,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows || "<tr><td></td></tr>"}</table>`,
      );
    }

    case "callout": {
      const stripe = block.accent ? `border-left:4px solid ${attr(block.accent)};` : "";
      /*
       * Written twice when there is one, and not at all when there is not.
       *
       * Outlook throws away a background in a style attribute, so bgcolor has
       * to be there too — but `bgcolor="transparent"` is not a colour, and a
       * callout with no fill should simply have none.
       */
      const fill = block.tint.trim();
      const painted = fill ? ` bgcolor="${attr(fill)}" ` : " ";
      const tint = fill ? `background:${attr(fill)};` : "";
      const icon = block.icon
        ? `<td valign="top" width="26" style="width:26px;font-size:16px;line-height:1.4;">${escapeHtml(block.icon)}</td>`
        : "";
      return cell(
        block,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${painted}style="${tint}${stripe}border-radius:${clamp(block.style?.border?.radius ?? 8, 0, 24)}px;">
<tr><td style="padding:14px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${icon}<td style="${typography(block, theme, { size: 15, weight: 400 })};text-align:${block.align};">${inline(block.html, theme.link)}</td></tr></table></td></tr>
</table>`,
      );
    }

    case "stat": {
      const count = Math.max(1, block.items.length);
      const share = Math.floor(100 / count);
      const cells = block.items
        .map(
          (item) =>
            `<td width="${share}%" valign="top" align="${block.align}" style="width:${share}%;padding:0 6px;">
<div style="${typography(block, theme, { size: clamp(block.valueSize, 12, 72), weight: 700 })};color:${attr(block.valueColor)};line-height:1.15;">${escapeHtml(item.value)}</div>
<div style="font-family:${attr(theme.font)};font-size:13px;color:${attr(block.style?.color ?? "#71717a")};padding-top:4px;">${escapeHtml(item.label)}</div>
</td>`,
        )
        .join("");
      return cell(
        block,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells || "<td></td>"}</tr></table>`,
      );
    }

    case "menu": {
      const gap = escapeHtml(block.separator || "\u00b7");
      const links = block.links
        .map(
          (link) =>
            `<a href="${attr(link.href)}" style="color:${attr(block.style?.color ?? theme.link)};text-decoration:none;white-space:nowrap;">${escapeHtml(link.label)}</a>`,
        )
        .join(`<span style="padding:0 8px;color:#a1a1aa;">${gap}</span>`);
      return cell(
        block,
        `<div style="${typography(block, theme, { size: 13, weight: 500 })};text-align:${block.align};">${links}</div>`,
      );
    }

    case "gallery": {
      const shown = block.images.filter((image) => image.src);
      if (shown.length === 0) return "";

      const perRow = clamp(Math.round(block.perRow), 2, 4);
      const padding = block.style?.padding ?? defaultPadding("gallery");
      const room = theme.width - padding[1] - padding[3];
      const gap = clamp(block.gap, 0, 40);
      const each = Math.floor((room - gap * (perRow - 1)) / perRow);
      const radius = block.radius > 0 ? `border-radius:${clamp(block.radius, 0, 40)}px;` : "";

      // A row of cells per row of pictures: one long row that wraps is a
      // thing CSS does and tables do not.
      const rows: string[] = [];
      for (let at = 0; at < shown.length; at += perRow) {
        const slice = shown.slice(at, at + perRow);
        const cells = slice
          .map((image, index) => {
            const right = index === perRow - 1 ? 0 : gap;
            const picture = `<img src="${attr(image.src)}" alt="${attr(image.alt)}" width="${each}" style="display:block;width:${each}px;max-width:100%;height:auto;${radius}border:0;">`;
            const wrapped = image.href
              ? `<a href="${attr(image.href)}" style="text-decoration:none;">${picture}</a>`
              : picture;
            return `<td valign="top" width="${each}" style="width:${each}px;padding:0 ${right}px ${gap}px 0;">${wrapped}</td>`;
          })
          .join("");
        // Pad the last row so three pictures across two columns do not stretch.
        const filler =
          slice.length < perRow
            ? `<td width="${each * (perRow - slice.length)}" style="width:${each * (perRow - slice.length)}px;"></td>`
            : "";
        rows.push(`<tr>${cells}${filler}</tr>`);
      }

      return cell(
        block,
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>`,
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
      // Nothing plays inside an email — every client strips the embed — so
      // what goes out is the video's own thumbnail, linked to it.
      const id = youtubeId(block.url);
      if (!id) return "";

      const padding = block.style?.padding ?? defaultPadding("youtube");
      const room = theme.width - padding[1] - padding[3];
      const width = Math.round((room * clamp(block.width, 10, 100)) / 100);
      const height = Math.round(width * 0.75);
      const radius = block.radius > 0 ? `border-radius:${clamp(block.radius, 0, 40)}px;` : "";

      const thumb = youtubeThumb(id);
      const watch = youtubeWatch(id);
      const alt = attr(block.caption || "Watch the video");

      const caption = block.caption
        ? `<div style="${typography(block, theme, { size: 13, weight: 500 })};text-align:${block.align};padding-top:8px;">${escapeHtml(block.caption)}</div>`
        : "";

      /*
       * With a badge, the thumbnail becomes the background of a cell and the
       * badge sits in the middle of it. Overlaying with a negative margin is
       * the obvious way and it does not survive contact with a mail client:
       * the margin collapses, or is ignored, and the badge lands under the
       * picture rather than on it.
       *
       * A cell background is what email settled on, carried twice — the
       * `background` attribute for the clients that read only that, and the
       * CSS for the ones that read only this. Outlook reads neither, so it is
       * given the same picture through VML, which Word does understand.
       *
       * The badge is drawn rather than fetched: a triangle in a red box needs
       * no hosted image, and an image of a play button is one more thing to
       * block, break, or have to serve.
       */
      const play = `<a href="${attr(watch)}" style="text-decoration:none;"><span style="display:inline-block;width:68px;height:48px;line-height:48px;border-radius:12px;background-color:#ff0000;color:#ffffff;font-family:Arial,sans-serif;font-size:22px;text-align:center;text-decoration:none;">&#9654;</span></a>`;

      const picture = block.playButton
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${block.align}" width="${width}" style="width:${width}px;max-width:100%;">
<tr><td background="${attr(thumb)}" bgcolor="#000000" width="${width}" height="${height}" valign="middle" align="center" style="width:${width}px;height:${height}px;background-image:url('${attr(thumb)}');background-position:center;background-size:cover;${radius}">
<!--[if gte mso 9]>
<v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${width}px;height:${height}px;">
<v:fill type="frame" src="${attr(thumb)}" color="#000000" />
<v:textbox inset="0,0,0,0">
<![endif]-->
${play}
<!--[if gte mso 9]>
</v:textbox>
</v:rect>
<![endif]-->
</td></tr>
</table>`
        : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${block.align}"><tr><td>
<a href="${attr(watch)}" style="text-decoration:none;"><img src="${attr(thumb)}" alt="${alt}" width="${width}" style="display:block;width:${width}px;max-width:100%;height:auto;${radius}border:0;outline:none;text-decoration:none;"></a>
</td></tr></table>`;

      return cell(block, `${picture}${caption}`);
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
      // Pictures, not letters. An icon cannot be an SVG — Gmail strips them —
      // or a data: URI, which no client fetches, so each one is a real file
      // this instance serves, addressed absolutely because the reader is
      // somewhere else entirely.
      const size = clamp(block.size ?? 24, 12, 64);
      const links = block.links
        .filter((link) => link.href)
        .map((link) => {
          const label = networkLabel(link.network);
          return `<a href="${attr(link.href)}" style="display:inline-block;margin:0 6px;text-decoration:none;"><img src="${attr(networkIcon(link.network, block.tone ?? "dark", theme.origin ?? ""))}" alt="${attr(label)}" title="${attr(label)}" width="${size}" height="${size}" style="display:inline-block;width:${size}px;height:${size}px;border:0;outline:none;"></a>`;
        })
        .join("");
      return cell(
        block,
        `<div style="text-align:${block.align};font-size:0;line-height:0;">${links}</div>`,
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
        for (const column of block.columns) {
          parts.push(designToText({ ...design, blocks: column.blocks }));
        }
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
        parts.push(
          block.links.map((link) => `${networkLabel(link.network)}: ${link.href}`).join("\n"),
        );
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
      case "list":
        parts.push(
          block.items
            .map((item, index) =>
              block.ordered ? `${index + 1}. ${stripTags(item)}` : `- ${stripTags(item)}`,
            )
            .join("\n"),
        );
        break;
      case "callout":
        parts.push(stripTags(block.html));
        break;
      case "stat":
        parts.push(block.items.map((item) => `${item.value} ${item.label}`).join("\n"));
        break;
      case "menu":
        parts.push(block.links.map((link) => `${link.label}: ${link.href}`).join("\n"));
        break;
      case "gallery":
        parts.push(
          block.images
            .filter((image) => image.alt)
            .map((image) => `[${image.alt}]`)
            .join(" "),
        );
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

      // A colour set on a selection is the one styling worth keeping: it is
      // how one word, or one link, is made a different colour from the block
      // around it, and there is nowhere else to say it.
      const colour = pickColour(rest);

      if (tag === "a") {
        const href = /href\s*=\s*["']([^"']*)["']/i.exec(rest)?.[1] ?? "";
        if (!safeHref(href)) {
          open.push("span");
          return colour ? `<span style="color:${colour};">` : "<span>";
        }
        open.push("a");
        return `<a href="${attr(href)}" style="color:${colour ?? attr(linkColor)};text-decoration:underline;">`;
      }

      open.push(tag);
      return colour ? `<${tag} style="color:${colour};">` : `<${tag}>`;
    },
  );
}

/**
 * A colour out of a style attribute, if it is one.
 *
 * Matched against a shape rather than parsed: a hex, an rgb(), or a plain
 * word. Anything else — a url(), an expression, a second declaration smuggled
 * in behind a semicolon — is not a colour and does not come through.
 */
function pickColour(rest: string): string | null {
  const style = /style\s*=\s*["']([^"']*)["']/i.exec(rest)?.[1];
  if (!style) return null;

  const value = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim();
  if (!value) return null;

  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(value) ? value : null;
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
