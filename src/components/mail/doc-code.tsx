"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * A code sample from the documentation.
 *
 * Every sample here is something somebody is about to paste into a terminal
 * or an editor, so the copy button is the whole point of the component: a
 * `curl` call wrapped across four lines is selected wrongly by hand more
 * often than it is selected rightly.
 */
export function DocCode({
  code,
  label,
  children,
}: {
  /** The plain text, which is what the copy button hands over. */
  code: string;
  label?: string;
  /** The same text, coloured on the server. */
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="group relative my-4 overflow-hidden rounded-xl border border-border bg-muted/40">
      {label && (
        <div className="border-b border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
          {label}
        </div>
      )}
      <button
        type="button"
        aria-label="Copy this sample"
        onClick={() => {
          navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        // Only on hover, because a button sitting over the first line of every
        // sample on a long page is a page of buttons.
        className="absolute top-2 right-2 z-10 rounded-md border border-border bg-card p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed">
        <code>{children ?? code}</code>
      </pre>
    </div>
  );
}
