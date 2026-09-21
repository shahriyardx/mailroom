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
 * What is running, under the wordmark.
 *
 * Somebody self-hosting has no app store to tell them a release happened, and
 * the version they are on is the first thing any bug report needs. Both are
 * one line, and the line only becomes a link when there is somewhere to go.
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

  if (!status) return null;

  if (!status.update_available || !status.url) {
    return (
      <span className="text-[11px] text-muted-foreground leading-tight">v{status.current}</span>
    );
  }

  return (
    <a
      href={status.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 text-[11px] text-muted-foreground leading-tight transition-colors hover:text-foreground"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />v{status.current} →{" "}
      {status.latest}
      <ArrowUpRight className="size-3" />
    </a>
  );
}
