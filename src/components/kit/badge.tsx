import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/** Anything stating a status is a pill. Never a rectangle. */
const badge = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        accent: "bg-primary-soft text-primary-soft-foreground",
        ok: "bg-ok-soft text-ok",
        warn: "bg-warn-soft text-warn",
        danger: "bg-danger-soft text-destructive",
        info: "bg-info-soft text-info",
        solid: "bg-primary text-primary-foreground",
        outline: "border border-border text-muted-foreground",
      },
      size: {
        sm: "h-[18px] px-1.5 text-[10.5px]",
        md: "h-[22px] px-2 text-[11.5px]",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export interface BadgeProps extends React.ComponentProps<"span">, VariantProps<typeof badge> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badge({ tone, size }), className)} {...props} />;
}

/** A state with a fixed vocabulary, so the same word always looks the same. */
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

/** A count that sits at the end of a navigation row. */
export function Count({
  value,
  active,
  className,
  ...props
}: React.ComponentProps<"span"> & { value: number; active?: boolean }) {
  if (!value) return null;
  return (
    <span
      className={cn(
        "ml-auto shrink-0 font-mono text-[11px] tabular-nums",
        active ? "text-primary" : "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {value > 999 ? "999+" : value}
    </span>
  );
}

export { badge as badgeVariants };
