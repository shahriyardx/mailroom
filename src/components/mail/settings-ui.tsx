"use client";

import { Badge } from "@/components/kit";
import { cn } from "@/lib/utils";

/** A settings section: what it is, one line on why, then its controls. */
export function Panel({
  title,
  description,
  meta,
  action,
  children,
}: {
  title: string;
  description: string;
  meta?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-raise">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14.5px] font-semibold tracking-[-0.01em]">{title}</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        {meta && <span className="shrink-0 text-[12px] text-muted-foreground">{meta}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as a child
    <label className={cn("block space-y-1.5", className)}>
      <span className="block text-[12.5px] font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

export function StatusPill({
  state,
  children,
}: {
  state: "ok" | "pending" | "bad";
  children: React.ReactNode;
}) {
  const tone = { ok: "ok", pending: "warn", bad: "danger" } as const;
  return (
    <Badge size="sm" tone={tone[state]} className="shrink-0">
      {children}
    </Badge>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-muted-foreground">{children}</p>;
}
