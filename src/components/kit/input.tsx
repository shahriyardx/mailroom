"use client";

import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const field = cva(
  [
    "w-full min-w-0 text-foreground transition-[background-color,border-color,box-shadow] duration-150",
    "placeholder:text-muted-foreground/70 outline-none",
    "disabled:cursor-not-allowed disabled:opacity-55",
    "aria-invalid:border-destructive aria-invalid:focus-visible:outline-destructive",
  ],
  {
    variants: {
      variant: {
        // Default: a soft well, no hard border until focus.
        filled:
          "border border-transparent bg-muted focus-visible:border-border focus-visible:bg-card",
        outline: "border border-input bg-card shadow-raise",
        // For inline rows (composer To/Cc) where the row itself is the frame.
        bare: "border-0 bg-transparent px-0 shadow-none focus-visible:outline-none",
      },
      size: {
        sm: "h-8 rounded-lg px-2.5 text-[13px]",
        md: "h-9 rounded-[10px] px-3 text-[13.5px]",
        lg: "h-11 rounded-xl px-3.5 text-[14px]",
      },
      mono: { true: "font-mono text-[12.5px]", false: "" },
    },
    defaultVariants: { variant: "filled", size: "md", mono: false },
  },
);

export interface InputProps
  extends Omit<React.ComponentProps<"input">, "size">,
    VariantProps<typeof field> {}

export function Input({ className, variant, size, mono, ...props }: InputProps) {
  return (
    <input data-slot="input" className={cn(field({ variant, size, mono }), className)} {...props} />
  );
}

export interface TextareaProps
  extends Omit<React.ComponentProps<"textarea">, "size">,
    VariantProps<typeof field> {}

export function Textarea({ className, variant, size, mono, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        field({ variant, size, mono }),
        // Height comes from rows, not the size scale.
        "h-auto min-h-20 resize-y py-2 leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}
