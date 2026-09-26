"use client";

import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * An id as a chip that copies itself.
 *
 * The id is what code sends by, so the one thing anybody does with it is put
 * it somewhere else. Selecting a long string by hand, inside a row that opens
 * a page when clicked, was not a way to do that.
 */
export function CopyId({ id, className }: { id: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      title="Copy the id"
      aria-label={copied ? "Copied" : `Copy ${id}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        navigator.clipboard.writeText(id).then(
          () => setCopied(true),
          () => {},
        );
      }}
      className={cn(
        "group/id inline-flex min-w-0 items-center gap-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <span className="truncate">{id}</span>
      {copied ? (
        <Check className="size-3 shrink-0 text-ok" />
      ) : (
        <Copy className="size-3 shrink-0 opacity-60 group-hover/id:opacity-100" />
      )}
    </button>
  );
}
