import type * as React from "react";

import { cn } from "@/lib/utils";

/** A list of records: hairlines between them, nothing around them. */
export function List({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="list" className={cn("divide-y divide-border", className)} {...props} />;
}

export function ListRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="list-row"
      className={cn("flex items-center gap-3 py-3", className)}
      {...props}
    />
  );
}

/** What a list says when it holds nothing. A sentence, not a shout. */
export function ListEmpty({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="list-empty"
      className={cn("py-5 text-[12.5px] text-muted-foreground", className)}
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
  action,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  icon?: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  /** The one thing to do from here. Inside the slate, not stranded below it. */
  action?: React.ReactNode;
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
      {action && <div className="mt-2">{action}</div>}
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
