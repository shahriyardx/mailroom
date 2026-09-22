"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";
import { useSection } from "./section";

/**
 * A list of records.
 *
 * On a settings screen: hairlines between the rows and nothing around them,
 * because the page already reads as one column of sections. On an application
 * screen the same list is a card — the shape every screen written for that
 * view uses, so a borrowed one does not arrive looking unfinished. The rows
 * take their side gutter from whichever of the two they are in.
 */
export function List({ className, ...props }: React.ComponentProps<"div">) {
  const app = useSection() === "app";

  return (
    <div
      data-slot="list"
      className={cn(
        "divide-y divide-border",
        app && "overflow-hidden rounded-2xl border border-border bg-card",
        className,
      )}
      {...props}
    />
  );
}

export function ListRow({ className, ...props }: React.ComponentProps<"div">) {
  const app = useSection() === "app";

  return (
    <div
      data-slot="list-row"
      className={cn("flex items-center gap-3 py-3", app && "px-4", className)}
      {...props}
    />
  );
}

/** What a list says when it holds nothing. A sentence, not a shout. */
export function ListEmpty({ className, ...props }: React.ComponentProps<"p">) {
  const app = useSection() === "app";

  return (
    <p
      data-slot="list-empty"
      className={cn("py-5 text-[12.5px] text-muted-foreground", app && "px-4", className)}
      {...props}
    />
  );
}

/**
 * What a list shows when it is empty and the reader is meant to fill it.
 * A sentence on its own reads as a stray line of text; the outline gives it
 * the shape of the rows that are missing.
 */
export function BlankSlate({
  icon,
  title,
  hint,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  icon?: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div
      data-slot="blank-slate"
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-border border-dashed px-6 py-8 text-center",
        className,
      )}
      {...props}
    >
      {icon && (
        <span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
      )}
      <p className="text-[13px] font-medium">{title}</p>
      {hint && <p className="max-w-xs text-[12.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A quiet note under or beside a control. */
export function Note({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="note"
      className={cn("text-[12.5px] leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

/** Closes a Fieldset: what the form does on the left, the button on the right. */
export function FieldsetActions({
  note,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { note?: React.ReactNode }) {
  return (
    <div
      data-slot="fieldset-actions"
      className={cn("mt-4 flex flex-wrap items-center justify-end gap-3", className)}
      {...props}
    >
      {note && <Note className="mr-auto max-w-md">{note}</Note>}
      {children}
    </div>
  );
}

/** The block that creates a record, set apart by space rather than a box. */
export function Fieldset({
  title,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { title?: React.ReactNode }) {
  return (
    <div data-slot="fieldset" className={cn("mt-5", className)} {...props}>
      {title && <p className="mb-3 text-[12.5px] font-semibold text-foreground">{title}</p>}
      {children}
    </div>
  );
}
