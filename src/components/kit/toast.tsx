"use client";

import { CheckCircle2, CircleAlert, Info, Loader2, TriangleAlert } from "lucide-react";
import { Toaster as Sonner } from "sonner";

/**
 * Sonner supplies the queueing and the timers; the styling is ours, so a
 * toast looks like the rest of the application rather than like a library.
 */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      offset={16}
      icons={{
        success: <CheckCircle2 className="size-4 text-ok" />,
        error: <CircleAlert className="size-4 text-destructive" />,
        warning: <TriangleAlert className="size-4 text-warn" />,
        info: <Info className="size-4 text-info" />,
        loading: <Loader2 className="size-4 animate-spin text-muted-foreground" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-2.5 rounded-xl border border-border bg-popover px-3.5 py-3 text-[13px] text-popover-foreground pop-shadow",
          title: "font-medium",
          description: "text-[12px] text-muted-foreground",
          actionButton:
            "ml-auto rounded-full bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground",
          cancelButton:
            "ml-auto rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground",
        },
      }}
    />
  );
}
