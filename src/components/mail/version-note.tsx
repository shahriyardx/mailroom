"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";

interface Status {
  current: string;
  latest: string | null;
  update_available: boolean;
  url: string | null;
}

/**
 * Inlined by `next.config.ts` at build time, in the browser bundle as well as
 * on the server, so the version can be drawn on the first paint rather than
 * after a round trip. What is running is decided when the image is built.
 */
const RUNNING = process.env.APP_VERSION ?? "";

/**
 * What is running, under the wordmark.
 *
 * Somebody self-hosting has no app store to tell them a release happened, and
 * the version they are on is the first thing any bug report needs. Both are
 * one line, and the line only becomes a link when there is somewhere to go.
 *
 * The number is there immediately: it is a build-time constant, and it used
 * to wait on a call that asks GitHub, so the sidebar rendered without it and
 * it appeared a moment later. Only the "something newer exists" half needs
 * the network, and that half is allowed to arrive late.
 */
export function VersionNote() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/version")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Status | null) => {
        if (!cancelled && data) setStatus(data);
      })
      .catch(() => {
        // The sidebar renders without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The server knows better than the constant only when they disagree, which
  // they cannot: both come from the same build.
  const current = status?.current ?? RUNNING;
  if (!current) return null;

  if (!status?.update_available || !status.url) {
    return <span className="text-[11px] text-muted-foreground leading-tight">v{current}</span>;
  }

  return (
    <a
      href={status.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 text-[11px] text-muted-foreground leading-tight transition-colors hover:text-foreground"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />v{current} →{" "}
      {status.latest}
      <ArrowUpRight className="size-3" />
    </a>
  );
}
