"use client";

import { cn } from "@/lib/utils";

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
    <section className="rounded-sm border bg-card p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-medium text-[13.5px]">{title}</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
        </div>
        {meta && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
            {meta}
          </span>
        )}
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
    <label className={cn("block space-y-1", className)}>
      <span className="font-mono text-[10.5px] text-muted-foreground uppercase tracking-[0.1em]">
        {label}
      </span>
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
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[10.5px]",
        state === "ok" && "border-ok/30 bg-ok/10 text-ok",
        state === "pending" && "border-warn/30 bg-warn/10 text-warn",
        state === "bad" && "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
      {children}
    </p>
  );
}
