import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The mark: a roofline over a letter slot. An envelope says mail; the roof
 * and the slot say the room the mail is sorted in. The slot is a hole in the
 * path, so whatever sits behind shows through and it stays legible at 16px.
 */
export function MailroomMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      role="presentation"
      aria-hidden="true"
      className={cn("size-full", className)}
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.4c-.33 0-.65.1-.92.29L2.7 8.5A1.6 1.6 0 0 0 2 9.82V19a2.8 2.8 0 0 0 2.8 2.8h14.4A2.8 2.8 0 0 0 22 19V9.82a1.6 1.6 0 0 0-.7-1.32l-8.38-5.81A1.6 1.6 0 0 0 12 2.4Zm-3.4 10.25h6.8a1.35 1.35 0 0 1 0 2.7H8.6a1.35 1.35 0 0 1 0-2.7Z"
      />
    </svg>
  );
}

const SIZES = {
  sm: "size-6 rounded-[7px] [&>svg]:size-4",
  md: "size-7 rounded-[9px] [&>svg]:size-[18px]",
  lg: "size-9 rounded-xl [&>svg]:size-6",
  xl: "size-12 rounded-2xl [&>svg]:size-8",
} as const;

/** The mark on its accent chip. */
export function Logo({
  size = "md",
  className,
  ...props
}: React.ComponentProps<"span"> & { size?: keyof typeof SIZES }) {
  return (
    <span
      data-slot="logo"
      className={cn(
        "grid shrink-0 place-items-center bg-primary text-primary-foreground",
        SIZES[size],
        className,
      )}
      {...props}
    >
      <MailroomMark />
    </span>
  );
}

/** The mark and the name, set the way the product is written down. */
export function Wordmark({
  size = "md",
  className,
  ...props
}: React.ComponentProps<"span"> & { size?: keyof typeof SIZES }) {
  return (
    <span
      data-slot="wordmark"
      className={cn("flex min-w-0 items-center gap-2", className)}
      {...props}
    >
      <Logo size={size} />
      <span
        className={cn(
          "truncate font-display font-semibold tracking-[-0.03em]",
          size === "xl" ? "text-[22px]" : size === "lg" ? "text-[18px]" : "text-[15.5px]",
        )}
      >
        Mailroom
      </span>
    </span>
  );
}
