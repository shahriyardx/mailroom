import type * as React from "react";

import { cn } from "@/lib/utils";

/** A surface that sits on the page. Depth stays rare; this is a hairline. */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-2xl border border-border bg-card text-card-foreground shadow-raise",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex items-start justify-between gap-4 px-5 pt-4 pb-3", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn("text-[14.5px] font-semibold tracking-[-0.01em]", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-body" className={cn("px-5 pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center gap-2 border-t border-border bg-muted/40 px-5 py-3",
        "rounded-b-2xl",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A settings section. Not a card: a heading, one line on why, then the
 * controls. The rule between sections comes from the page that stacks them.
 */
export function Panel({
  title,
  description,
  meta,
  action,
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A count or a state, stated quietly beside the title. */
  meta?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section data-slot="panel" className={cn("py-7 first:pt-6", className)} {...props}>
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[14.5px] font-semibold tracking-[-0.01em]">
            {title}
            {meta && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                {meta}
              </span>
            )}
          </h2>
          {description && (
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="-mt-1 shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
