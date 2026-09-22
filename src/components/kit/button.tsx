"use client";

import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

const button = cva(
  [
    "relative inline-flex shrink-0 select-none items-center justify-center gap-2",
    "whitespace-nowrap font-medium transition-[background-color,color,border-color,box-shadow]",
    "duration-150 outline-none disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        // The one action a screen is really about.
        solid:
          "bg-primary text-primary-foreground shadow-raise hover:bg-primary/90 active:bg-primary/95",
        // Secondary actions that still carry the accent.
        soft: "bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft/70",
        // Sits on a surface, reads as a control.
        outline: "border border-border bg-card text-foreground shadow-raise hover:bg-accent",
        // Neutral filled, for toolbars.
        subtle: "bg-muted text-foreground hover:bg-accent",
        // No chrome until you touch it.
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        /*
         * Destructive, but not yet done. A tint and red lettering read as
         * "this one is dangerous" without shouting it from across the page —
         * which matters because most of these only open a confirmation, and a
         * solid red button that turns out to be a question is a small lie.
         */
        danger:
          "border border-destructive/30 bg-destructive/10 text-destructive hover:border-destructive/45 hover:bg-destructive/15",
        /** The last press, where weight is the point. */
        "danger-solid":
          "bg-destructive text-destructive-foreground shadow-raise hover:bg-destructive/90",
        "danger-ghost": "text-muted-foreground hover:bg-danger-soft hover:text-destructive",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /*
       * Horizontal padding is set against the label, not the height. A 13px
       * word inside 10px of space reads as cramped however tall the button
       * is, which is what these were: the text had grown and the padding had
       * not followed it.
       */
      size: {
        xs: "h-7 rounded-lg px-2.5 text-[12px] [&_svg]:size-3.5",
        sm: "h-8 rounded-lg px-3 text-[13px] [&_svg]:size-4",
        md: "h-9 rounded-[10px] px-4 text-[13.5px] [&_svg]:size-4",
        lg: "h-10 rounded-xl px-5.5 text-[14px] [&_svg]:size-4",
      },
      // Status-bearing and primary actions are pills, per the design rules.
      pill: { true: "rounded-full", false: "" },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "outline", size: "sm", pill: false, block: false },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof button> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  pill,
  block,
  asChild,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(button({ variant, size, pill, block }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" />
          {/* Keep the label so the button does not resize mid-action. */}
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

const iconButton = cva(
  [
    "inline-flex shrink-0 items-center justify-center transition-colors duration-150",
    "outline-none disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        subtle: "bg-muted text-foreground hover:bg-accent",
        outline: "border border-border bg-card text-foreground shadow-raise hover:bg-accent",
        soft: "bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft/70",
        solid: "bg-primary text-primary-foreground shadow-raise hover:bg-primary/90",
        danger: "text-muted-foreground hover:bg-danger-soft hover:text-destructive",
      },
      size: {
        xs: "size-7 rounded-lg [&_svg]:size-3.5",
        sm: "size-8 rounded-lg [&_svg]:size-4",
        md: "size-9 rounded-[10px] [&_svg]:size-[18px]",
      },
      pill: { true: "rounded-full", false: "" },
      active: { true: "", false: "" },
    },
    compoundVariants: [{ variant: "ghost", active: true, className: "bg-accent text-foreground" }],
    defaultVariants: { variant: "ghost", size: "sm", pill: false, active: false },
  },
);

export interface IconButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof iconButton> {
  asChild?: boolean;
  /** Required: an icon alone never explains itself. */
  label: string;
}

export function IconButton({
  className,
  variant,
  size,
  pill,
  active,
  asChild,
  label,
  ...props
}: IconButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="icon-button"
      aria-label={label}
      title={label}
      className={cn(iconButton({ variant, size, pill, active }), className)}
      {...props}
    />
  );
}

export { button as buttonVariants };
