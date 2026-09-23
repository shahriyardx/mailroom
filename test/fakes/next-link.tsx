import type { ReactNode } from "react";

/**
 * `next/link` outside Next.
 *
 * It needs a router at import time, which a test has no business standing up.
 * What a test cares about is the address in the markup, and an anchor carries
 * that just as well.
 */
export default function Link({
  href,
  children,
  ...rest
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
