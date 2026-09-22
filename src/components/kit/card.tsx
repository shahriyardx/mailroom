"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";
import { useSection } from "./section";

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
  const section = useSection();

  /*
   * On an application screen each panel is its own surface with a heading
   * that carries weight, rather than a block in a divided list. It is the
   * same component and the same content — a settings screen is scanned once
   * a quarter, an application screen is worked in, and they do not want the
   * same density.
   */
  const app = section === "app";

  const heading = (
    <div className={cn("flex items-start gap-3", app ? "mb-3.5" : "mb-4")}>
      <div className="min-w-0 flex-1">
        <h2
          className={cn(
            "flex items-center gap-2 font-semibold",
            app
              ? "font-display text-[22px] leading-none tracking-[-0.025em]"
              : "text-[14.5px] tracking-[-0.01em]",
          )}
        >
          {title}
          {meta && (
            <span
              className={cn(
                "rounded-full bg-muted px-1.5 py-0.5 font-medium text-muted-foreground tabular-nums",
                app ? "font-sans text-[11.5px]" : "text-[11px]",
              )}
            >
              {meta}
            </span>
          )}
        </h2>
        {description && (
          <p
            className={cn(
              "leading-relaxed text-muted-foreground",
              app ? "mt-1.5 text-[12.5px]" : "mt-0.5 text-[12.5px]",
            )}
          >
            {description}
          </p>
        )}
      </div>
      {action && <div className={cn("shrink-0", app ? "" : "-mt-1")}>{action}</div>}
    </div>
  );

  /*
   * On an application screen the heading sits above its content rather than
   * inside a card with it — the shape the screens written for this view
   * already use, so a borrowed one does not announce that it was borrowed.
   *
   * No card around the content. An earlier version put one there and every
   * panel whose content is its own surface — a search field, a bordered list,
   * a table — became a box inside a box, with its dividers inset from a
   * border they were already drawing against. A page that wants a card asks
   * for one; a panel does not impose it.
   */
  if (app) {
    return (
      <section data-slot="panel" className={cn("mb-8 last:mb-0", className)} {...props}>
        {heading}
        {children}
      </section>
    );
  }

  return (
    <section data-slot="panel" className={cn("py-7 first:pt-6", className)} {...props}>
      {heading}
      {children}
    </section>
  );
}
