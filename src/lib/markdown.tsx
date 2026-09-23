import { DocCode } from "@/components/mail/doc-code";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The documentation Markdown, as React.
 *
 * Deliberately a subset rather than a parser: the only Markdown this ever
 * sees is the Markdown in this repository, so it has to handle what those
 * pages use and nothing else. That buys a renderer with no dependency, no
 * `dangerouslySetInnerHTML`, and components — the copy button on a sample,
 * the app's own link component — where a string of HTML would have none.
 *
 * What it understands: headings, paragraphs, lists, tables, fenced code with
 * an optional label, the `:::` callouts VitePress uses, rules, and inline
 * code, bold, italic, links and images.
 */

export interface DocHeading {
  id: string;
  text: string;
  /** 2 or 3. The outline does not go deeper, because nothing reads deeper. */
  level: number;
}

export interface RenderedDoc {
  /** The page's own `# heading`, lifted out so the page can draw it itself. */
  title: string;
  body: ReactNode;
  headings: DocHeading[];
}

interface Ctx {
  headings: DocHeading[];
  /** Slugs already used, so two "## Errors" do not share one anchor. */
  seen: Map<string, number>;
}

export function renderDoc(source: string): RenderedDoc {
  const ctx: Ctx = { headings: [], seen: new Map() };
  const lines = prepare(source).split("\n");

  // The first `# heading` is the page title and is drawn by the page header,
  // so it is taken out here rather than printed twice.
  let title = "";
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const heading = /^#\s+(.*)$/.exec(lines[i]);
    if (heading) {
      title = heading[1].trim();
      start = i + 1;
    }
    break;
  }

  return { title, body: blocks(lines.slice(start), ctx), headings: ctx.headings };
}

/** The first sentence of a page, for a listing. */
export function summarise(source: string): string {
  for (const block of prepare(source).split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || /^[#:|`>-]/.test(text)) continue;
    const sentence = text.replace(/\s+/g, " ").replace(/[*`[\]]|\([^)]*\)/g, "");
    if (sentence.length < 40) continue;
    return sentence.length > 180 ? `${sentence.slice(0, 177)}…` : sentence;
  }
  return "";
}

/**
 * Frontmatter is for the site builder, and `<code v-pre>` is how the Markdown
 * stops VitePress from treating `{{ name }}` as a Vue expression. Neither
 * means anything here; the second becomes the inline code it was always
 * standing in for.
 */
function prepare(source: string) {
  const body = source.startsWith("---")
    ? source.slice(source.indexOf("\n---", 3) + 4).replace(/^\n+/, "")
    : source;
  return body
    .replace(/\r\n/g, "\n")
    .replace(/<code v-pre>([\s\S]*?)<\/code>/g, (_, code: string) => `\`${code}\``);
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                      */
/* -------------------------------------------------------------------------- */

function blocks(lines: string[], ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code. The info string may carry a language and, inside a code
    // group, a label in square brackets: ```ts [Next.js]
    if (line.startsWith("```")) {
      const info = line.slice(3).trim();
      const label = /\[([^\]]+)\]/.exec(info)?.[1];
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      out.push(<DocCode key={`code-${out.length}`} code={code.join("\n")} label={label} />);
      continue;
    }

    // ::: warning Some title … :::
    if (line.startsWith(":::")) {
      const opening = line.slice(3).trim();
      const kind = opening.split(/\s+/)[0] || "info";
      const heading = opening.slice(kind.length).trim();
      const inner: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ":::") {
        inner.push(lines[i]);
        i++;
      }
      i++;
      out.push(
        <Callout key={`callout-${out.length}`} kind={kind} title={heading}>
          {blocks(inner, ctx)}
        </Callout>,
      );
      continue;
    }

    const heading = /^(#{2,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(headingNode(heading[1].length, heading[2].trim(), ctx, out.length));
      i++;
      continue;
    }

    if (/^-{3,}$/.test(line.trim())) {
      out.push(<hr key={`rule-${out.length}`} className="my-8 border-border" />);
      i++;
      continue;
    }

    // A table is a row followed by a row of dashes, and nothing else is.
    if (line.trimStart().startsWith("|") && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) {
        rows.push(lines[i]);
        i++;
      }
      out.push(tableNode(rows, ctx, out.length));
      continue;
    }

    if (isListStart(line)) {
      const taken = takeList(lines, i);
      out.push(listNode(taken.items, taken.ordered, ctx, out.length));
      i = taken.next;
      continue;
    }

    // Anything else is a paragraph, running to the next blank line or block.
    const text: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      text.push(lines[i].trim());
      i++;
    }
    if (text.length > 0) {
      out.push(
        <p key={`p-${out.length}`} className="my-4 text-[13.5px] leading-[1.75]">
          {inline(text.join(" "))}
        </p>,
      );
      continue;
    }

    // A line that opens a block this loop did not claim: skip it rather than
    // spin, which is the one way a parser like this can hang.
    i++;
  }

  return out;
}

function startsBlock(line: string) {
  return (
    line.startsWith("```") ||
    line.startsWith(":::") ||
    /^#{1,6}\s/.test(line) ||
    line.trimStart().startsWith("|") ||
    isListStart(line)
  );
}

function isListStart(line: string) {
  return /^([-*]|\d+\.)\s+/.test(line);
}

function headingNode(level: number, text: string, ctx: Ctx, index: number) {
  const id = slug(text, ctx);
  if (level <= 3) ctx.headings.push({ id, text: plain(text), level });

  const size =
    level === 2
      ? "mt-10 mb-3 font-display text-[19px] tracking-[-0.02em]"
      : level === 3
        ? "mt-7 mb-2 text-[15px] font-semibold"
        : "mt-6 mb-2 text-[13.5px] font-semibold text-muted-foreground";

  const Tag = (level === 2 ? "h2" : level === 3 ? "h3" : "h4") as "h2" | "h3" | "h4";

  return (
    <Tag key={`h-${index}`} id={id} className={`scroll-mt-20 ${size}`}>
      {inline(text)}
    </Tag>
  );
}

function tableNode(rows: string[], ctx: Ctx, index: number) {
  const cells = (row: string) =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const header = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  // Some tables are two unlabelled columns — a term and what it means. A head
  // of empty cells would draw a rule under nothing.
  const labelled = header.some((cell) => cell.length > 0);

  return (
    <div key={`table-${index}`} className="my-5 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-[13px]">
        {labelled && (
          <thead>
            <tr className="bg-muted/50">
              {header.map((cell) => (
                <th
                  key={`${index}-th-${cell}`}
                  className="border-border border-b px-3 py-2 text-left font-medium"
                >
                  {inline(cell)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={`${index}-tr-${row.join("|")}`} className={rowIndex > 0 ? "border-t" : ""}>
              {row.map((cell, cellIndex) => (
                <td
                  key={`${index}-td-${rowIndex}-${cellIndex}-${cell}`}
                  className="border-border px-3 py-2 align-top leading-relaxed"
                >
                  {inline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Collects a whole list, including the lines that belong to an item without
 * starting one: a nested list, a sample, or a second paragraph.
 */
function takeList(lines: string[], start: number) {
  const ordered = /^\d+\./.test(lines[start]);
  const items: string[][] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      const next = lines[i + 1] ?? "";
      // A blank line ends the list unless what follows still belongs to it.
      if (!isListStart(next) && !/^\s{2,}\S/.test(next)) break;
      items[items.length - 1]?.push("");
      i++;
      continue;
    }

    const marker = /^([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (marker) {
      items.push([marker[2]]);
      i++;
      continue;
    }

    if (items.length === 0) break;
    // Indented, so it is inside the item above. Dedent by one level so the
    // recursive pass sees it as ordinary lines.
    items[items.length - 1].push(line.replace(/^ {1,4}/, ""));
    i++;
  }

  return { items, ordered, next: i };
}

function listNode(items: string[][], ordered: boolean, ctx: Ctx, index: number) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      key={`list-${index}`}
      className={`my-4 space-y-1.5 pl-5 text-[13.5px] leading-[1.7] ${
        ordered ? "list-decimal" : "list-disc"
      } marker:text-muted-foreground`}
    >
      {items.map((item) => (
        <li key={`${index}-li-${item[0]}`}>{listItem(item, ctx)}</li>
      ))}
    </Tag>
  );
}

/**
 * An item's own text stays inline, so a one-line bullet is not wrapped in a
 * paragraph with a paragraph's margins. Anything after it — a nested list, a
 * sample — goes back through the block pass.
 */
function listItem(item: string[], ctx: Ctx) {
  const lead: string[] = [];
  let i = 0;
  while (i < item.length && item[i].trim() && !startsBlock(item[i])) {
    lead.push(item[i].trim());
    i++;
  }
  const rest = item.slice(i);
  return (
    <>
      {inline(lead.join(" "))}
      {rest.some((line) => line.trim()) ? (
        <div className="[&>:first-child]:mt-2">{blocks(rest, ctx)}</div>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Inline                                                                      */
/* -------------------------------------------------------------------------- */

const INLINE =
  /(`[^`]+`)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    last = at + match[0].length;
    const key = `i-${at}`;

    const token = match[0];

    if (token.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="rounded-[5px] bg-muted px-[0.35em] py-[0.12em] font-mono text-[0.88em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
      continue;
    }

    if (token.startsWith("![")) {
      const parts = /!\[([^\]]*)\]\(([^)\s]+)\)/.exec(token);
      if (!parts) continue;
      out.push(
        // Plain <img>: these are screenshots of unknown size read from the
        // docs folder, not assets the image pipeline knows the dimensions of.
        <img
          key={key}
          src={asset(parts[2])}
          alt={parts[1]}
          className="my-5 w-full rounded-xl border border-border"
        />,
      );
      continue;
    }

    if (token.startsWith("[")) {
      const parts = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(token);
      if (!parts) continue;
      out.push(linkNode(parts[1], parts[2], key));
      continue;
    }

    if (token.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
      continue;
    }

    out.push(<em key={key}>{token.slice(1, -1)}</em>);
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

function linkNode(text: string, href: string, key: string) {
  if (/^https?:/.test(href)) {
    return (
      <a
        key={key}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-baseline gap-0.5 text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
      >
        {text}
        <ArrowUpRight className="size-3 self-center" />
      </a>
    );
  }

  return (
    <Link
      key={key}
      href={internal(href)}
      className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
    >
      {text}
    </Link>
  );
}

/**
 * A link in the Markdown is written for the published site, where the
 * documentation is the whole of the site. Here it is one section of the app,
 * so a root-relative link is moved under that section.
 */
function internal(href: string) {
  if (href.startsWith("#")) return href;
  if (!href.startsWith("/")) return href;
  return `/docs${href.replace(/\/$/, "")}`;
}

/** The screenshots the published site serves from its own public folder. */
function asset(src: string) {
  return src.startsWith("/shots/") ? `/doc-assets${src}` : src;
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

const CALLOUTS: Record<string, { ring: string; label: string }> = {
  tip: { ring: "border-primary/30 bg-primary/[0.06]", label: "text-primary" },
  info: { ring: "border-info/30 bg-info-soft", label: "text-info" },
  warning: { ring: "border-warn/35 bg-warn-soft", label: "text-warn" },
  danger: { ring: "border-destructive/35 bg-danger-soft", label: "text-destructive" },
  details: { ring: "border-border bg-muted/40", label: "text-foreground" },
};

function Callout({
  kind,
  title,
  children,
}: {
  kind: string;
  title?: string;
  children: ReactNode;
}) {
  // A code group is a container too, but it is only a wrapper around the
  // samples inside it, each of which already carries its own label.
  if (kind === "code-group") return <div className="my-4">{children}</div>;

  const tone = CALLOUTS[kind] ?? CALLOUTS.info;

  return (
    <div className={`my-5 rounded-xl border px-4 py-3 ${tone.ring}`}>
      {title && <p className={`mb-1 font-medium text-[13px] ${tone.label}`}>{title}</p>}
      <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_p]:my-2">{children}</div>
    </div>
  );
}

/** The text of a heading with its markup taken off, for the outline. */
function plain(text: string) {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function slug(text: string, ctx: Ctx) {
  const base =
    plain(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section";

  const count = ctx.seen.get(base) ?? 0;
  ctx.seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}
