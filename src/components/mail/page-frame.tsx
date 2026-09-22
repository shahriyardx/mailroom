"use client";

import { Input } from "@/components/kit";
import { Search } from "lucide-react";

/**
 * The furniture an application screen has and a settings screen does not.
 *
 * A settings panel explains itself: a title, a sentence of prose, then the
 * controls. That reads well for something you visit twice a year and badly for
 * a screen somebody works in all day, where the title should be a heading and
 * the thing you came to do should be a button in the top right, not the first
 * form on the page.
 */

export function PageHeader({
  title,
  count,
  description,
  children,
}: {
  title: string;
  /** Shown beside the title when there is something to count. */
  count?: number;
  /**
   * What this page is, under its name. For a state that belongs to the thing
   * itself — how many people are on this list — rather than beside a search
   * box, where it reads as a stray result count.
   */
  description?: React.ReactNode;
  /** The primary action, and anything beside it. */
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        {/* leading-none: the display face carries a tall default line box, and
            the subtitle below it inherits that as a gap nobody asked for. */}
        <h1 className="flex min-w-0 items-center gap-2.5 font-display text-[26px] font-semibold leading-none tracking-[-0.025em]">
          {title}
          {count !== undefined && count > 0 ? (
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-sans text-[12px] font-medium text-muted-foreground">
              {count}
            </span>
          ) : null}
        </h1>
        {description ? (
          <p className="mt-1.5 text-[13px] leading-none text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

export function SearchBox({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative min-w-[180px] flex-1">
      <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-8"
      />
    </div>
  );
}

/**
 * The page's one content area.
 *
 * One bordered surface that holds either rows or the reason there are none,
 * rather than a stack of panels each with its own border. It keeps the empty
 * state the same size as the full one, so a screen does not appear to grow as
 * it fills.
 */
export function Surface({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-2xl border border-border bg-card">{children}</div>;
}

export function Empty({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  /** The same primary action as the header, repeated where the eye already is. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[380px] flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-4 grid size-14 place-items-center rounded-2xl border border-border bg-muted/50 text-muted-foreground [&_svg]:size-6">
        {icon}
      </span>
      <p className="font-display text-[17px] font-semibold tracking-[-0.02em]">{title}</p>
      <p className="mt-1.5 max-w-[34ch] text-[13px] leading-relaxed text-muted-foreground">
        {hint}
      </p>
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}

/** One row in a Surface. Separated by a line rather than a gap, like a table. */
export function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-border border-b px-4 py-3 last:border-b-0 hover:bg-muted/30">
      {children}
    </div>
  );
}
