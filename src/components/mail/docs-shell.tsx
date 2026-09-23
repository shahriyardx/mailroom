"use client";

import { IconButton, Input, Sheet, SheetContent, SheetTitle } from "@/components/kit";
import { DOC_SECTIONS, docHref } from "@/lib/docs-nav";
import { cn } from "@/lib/utils";
import { ArrowLeft, BookOpen, Menu, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

/**
 * The shell around the documentation.
 *
 * Its own navigation rather than the app's: the pages here are a book, and a
 * book is read by its own table of contents. One way back to wherever the
 * reader came from, at the top, where they will look for it.
 */
export function DocsShell({
  back,
  children,
}: {
  /** Where the reader was before they opened this. */
  back: { href: string; label: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer on navigation
  useEffect(() => setNavOpen(false), [pathname]);

  /*
   * Filtering by title rather than by content.
   *
   * Searching the text of forty pages would mean shipping the text of forty
   * pages to the browser. The titles are how somebody looks for a page they
   * have read before, which is what a reader of documentation mostly does.
   */
  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return DOC_SECTIONS;
    return DOC_SECTIONS.map((section) => ({
      ...section,
      groups: section.groups
        .map((group) => ({
          ...group,
          pages: group.pages.filter(
            (page) =>
              page.title.toLowerCase().includes(needle) || page.path.toLowerCase().includes(needle),
          ),
        }))
        .filter((group) => group.pages.length > 0),
    })).filter((section) => section.groups.length > 0);
  }, [query]);

  const nav = (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3 pt-4">
        <Link
          href={back.href}
          className="mb-3 flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {back.label}
        </Link>

        <Link href="/docs" className="mb-3 flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground">
            <BookOpen className="size-4" />
          </span>
          <span className="font-display text-[15px] tracking-[-0.02em]">Documentation</span>
        </Link>

        <div className="relative mb-2">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a page"
            className="h-8 pl-8 text-[12.5px]"
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        {sections.map((section) => (
          <div key={section.key} className="mb-4">
            <p className="px-2.5 py-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
              {section.title}
            </p>
            {section.groups.map((group) => (
              <div key={group.title} className="mb-1.5">
                {section.groups.length > 1 && (
                  <p className="px-2.5 py-1 text-[11.5px] text-muted-foreground">{group.title}</p>
                )}
                <ul className="space-y-px">
                  {group.pages.map((page) => {
                    const href = docHref(page.path);
                    const active = pathname === href;
                    return (
                      <li key={page.path}>
                        <Link
                          href={href}
                          className={cn(
                            "block rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                            active
                              ? "bg-card font-medium text-foreground shadow-sm"
                              : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                          )}
                        >
                          {page.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ))}

        {sections.length === 0 && (
          <p className="px-2.5 py-3 text-[12.5px] text-muted-foreground">No page by that name.</p>
        )}
      </nav>
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-card">
      <aside className="hidden w-[16rem] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        {nav}
      </aside>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="flex flex-col bg-sidebar p-0" showClose={false}>
          <SheetTitle className="sr-only">Documentation pages</SheetTitle>
          {nav}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center px-4 md:hidden">
          <IconButton
            size="md"
            label="Open the contents"
            className="-ml-1.5"
            onClick={() => setNavOpen(true)}
          >
            <Menu />
          </IconButton>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
