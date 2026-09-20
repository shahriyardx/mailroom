import type * as React from "react";

import { cn } from "@/lib/utils";

/** A list of records: hairlines between them, nothing around them. */
export function List({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="list"
      className={cn("divide-y divide-border border-y border-border", className)}
      {...props}
    />
  );
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
      className={cn("py-8 text-center text-[12.5px] text-muted-foreground", className)}
      {...props}
    />
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
