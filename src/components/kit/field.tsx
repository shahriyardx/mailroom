"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";

interface FieldProps extends Omit<React.ComponentProps<"div">, "title"> {
  label?: React.ReactNode;
  /** Explains the control before it is used. */
  hint?: React.ReactNode;
  /** Replaces the hint when present, and colours the control. */
  error?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  action?: React.ReactNode;
}

/**
 * Wraps any control with its label, hint and error so every form in the app
 * gets the same vertical rhythm.
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  action,
  className,
  children,
  ...props
}: FieldProps) {
  return (
    <div data-slot="field" className={cn("flex flex-col gap-1.5", className)} {...props}>
      {(label || action) && (
        <div className="flex min-h-5 items-center justify-between gap-3">
          {label && (
            <label
              htmlFor={htmlFor}
              className="text-[13px] font-medium leading-none text-foreground"
            >
              {label}
              {required && <span className="ml-0.5 text-destructive">*</span>}
            </label>
          )}
          {action}
        </div>
      )}
      {children}
      {error ? (
        <p className="text-[12px] leading-snug text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[12px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** A standalone label, for controls that sit outside a Field. */
export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the caller supplies htmlFor
    <label
      data-slot="label"
      className={cn(
        "text-[13px] font-medium leading-none text-foreground",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}

/** An input with its action glued to it: one field, one button, one line. */
export function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        "flex items-center gap-2 [&>*:first-child]:min-w-0 [&>*:first-child]:flex-1",
        className,
      )}
      {...props}
    />
  );
}
