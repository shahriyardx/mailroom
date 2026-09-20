import type * as React from "react";

import { cn } from "@/lib/utils";

/** One number that means something, with its name under it. */
export function Stat({
  label,
  value,
  sub,
  tone,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  label: React.ReactNode;
  value: React.ReactNode;
  /** A second line: a share, a comparison, a unit. */
  sub?: React.ReactNode;
  tone?: "ok" | "warn" | "bad";
}) {
  return (
    <div data-slot="stat" className={cn("min-w-0", className)}>
      <p
        className={cn(
          "font-display text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 truncate text-[12.5px] text-muted-foreground">{label}</p>
      {sub && <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground/70">{sub}</p>}
    </div>
  );
}

/** A row of stats, evenly spaced, wrapping on a narrow screen. */
export function Stats({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stats"
      className={cn("grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4", className)}
      {...props}
    />
  );
}

/** A proportion, drawn as one bar. Used for quotas and storage. */
export function Meter({
  value,
  max,
  tone = "accent",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  value: number;
  max: number;
  tone?: "accent" | "ok" | "warn" | "bad";
}) {
  const share = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      data-slot="meter"
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "accent" && "bg-primary",
          tone === "ok" && "bg-ok",
          tone === "warn" && "bg-warn",
          tone === "bad" && "bg-destructive",
        )}
        style={{ width: `${share}%` }}
      />
    </div>
  );
}
