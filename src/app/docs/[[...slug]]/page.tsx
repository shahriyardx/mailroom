import { DOC_SECTIONS, docHref } from "@/lib/docs-nav";
import { renderDoc, summarise } from "@/lib/markdown";
import { docForSlug, docSource, neighbours } from "@/server/docs";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;

  if (!slug || slug.length === 0) return <DocsHome />;

  const page = docForSlug(slug);
  if (!page) notFound();

  const source = await docSource(page);
  if (!source) notFound();

  const { title, body, headings } = renderDoc(source);
  const { previous, next } = neighbours(page);

  return (
    <div className="mx-auto flex w-full max-w-[64rem] gap-10 px-5 pt-6 pb-16 sm:px-8 md:pt-10">
      <article className="min-w-0 flex-1">
        <h1 className="mb-6 font-display text-[28px] leading-tight tracking-[-0.03em]">
          {title || page.title}
        </h1>

        {body}

        {/* One page follows another in a fixed order, so the way on is worth
            printing rather than leaving to the menu. */}
        <nav className="mt-12 flex gap-3 border-t border-border pt-5">
          {previous && (
            <Link
              href={docHref(previous.path)}
              className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-xl border border-border px-3.5 py-2.5 transition-colors hover:bg-accent"
            >
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ArrowLeft className="size-3" />
                Previous
              </span>
              <span className="truncate text-[13px] font-medium">{previous.title}</span>
            </Link>
          )}
          {next && (
            <Link
              href={docHref(next.path)}
              className="flex min-w-0 flex-1 flex-col items-end gap-0.5 rounded-xl border border-border px-3.5 py-2.5 text-right transition-colors hover:bg-accent"
            >
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                Next
                <ArrowRight className="size-3" />
              </span>
              <span className="truncate text-[13px] font-medium">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>

      {/* The outline, on a window wide enough to hold it beside the text. */}
      {headings.length > 1 && (
        <aside className="hidden w-[13rem] shrink-0 xl:block">
          <div className="sticky top-10">
            <p className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
              On this page
            </p>
            <ul className="space-y-1 border-l border-border">
              {headings.map((heading) => (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    className={`-ml-px block border-l border-transparent py-0.5 text-[12.5px] text-muted-foreground leading-snug transition-colors hover:border-primary hover:text-foreground ${
                      heading.level === 3 ? "pl-5" : "pl-3"
                    }`}
                  >
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
}

/** The way in: the four sections, and what each is for. */
async function DocsHome() {
  const sections = await Promise.all(
    DOC_SECTIONS.map(async (section) => {
      const first = section.groups[0].pages[0];
      const source = await docSource(first);
      return { ...section, first, summary: source ? summarise(source) : "" };
    }),
  );

  return (
    <div className="mx-auto w-full max-w-[52rem] px-5 pt-10 pb-16 sm:px-8">
      <h1 className="font-display text-[30px] leading-tight tracking-[-0.03em]">Documentation</h1>
      <p className="mt-2 max-w-[34rem] text-[13.5px] text-muted-foreground leading-relaxed">
        The guide, the API and the SDK, served by this instance itself — the same pages the
        published site is built from, at the version you are running.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {sections.map((section) => (
          <Link
            key={section.key}
            href={docHref(section.first.path)}
            className="group rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <p className="font-display text-[16px] tracking-[-0.02em]">{section.title}</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">
              {section.blurb}
            </p>
            <p className="mt-3 flex items-center gap-1 text-[12px] text-primary">
              {section.first.title}
              <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
