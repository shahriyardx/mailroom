"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";

/** The colour that marks a mailbox or a label everywhere else in the app. */
export function ColorPicker({
  value,
  onChange,
  palette,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  palette: readonly string[];
}) {
  return (
    <div
      data-slot="color-picker"
      role="radiogroup"
      className={cn("flex h-9 items-center gap-1.5", className)}
      {...props}
    >
      {palette.map((item) => (
        <button
          key={item}
          type="button"
          role="radio"
          aria-checked={value === item}
          aria-label={`Colour ${item}`}
          onClick={() => onChange(item)}
          className={cn(
            "size-6 rounded-full ring-offset-2 ring-offset-background transition",
            value === item && "ring-2 ring-ring",
          )}
          style={{ background: item }}
        />
      ))}
    </div>
  );
}

/** The six marks a mailbox or label can take. One lightness, six hues. */
export const PALETTE = [
  "oklch(0.55 0.16 278)",
  "oklch(0.55 0.11 238)",
  "oklch(0.54 0.11 158)",
  "oklch(0.58 0.13 68)",
  "oklch(0.55 0.15 22)",
  "oklch(0.52 0.13 318)",
] as const;
