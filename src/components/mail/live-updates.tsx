"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

interface MailEvent {
  type: string;
  from?: string;
  subject?: string;
}

/**
 * Holds one EventSource open and re-renders the server components when mail
 * arrives, so the list fills in without a poll and without a reload. Scroll
 * position, the open conversation and a half-written reply all survive,
 * because nothing is remounted.
 *
 * Renders nothing.
 */
export function LiveUpdates() {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/events");

    // A burst of messages should cost one re-render, not one each.
    const refreshSoon = () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => {
        router.refresh();
        // The sidebar counts are fetched by the shell, not rendered on the
        // server, so they need telling separately.
        window.dispatchEvent(new CustomEvent("mailroom:refresh"));
      }, 250);
    };

    const onReceived = (event: MessageEvent) => {
      refreshSoon();
      try {
        const data = JSON.parse(event.data) as MailEvent;
        toast(data.subject || "(no subject)", {
          description: data.from ? `New mail from ${data.from}` : "New mail",
        });
      } catch {
        // The refresh matters; the notice is a nicety.
      }
    };

    source.addEventListener("mail:received", onReceived);
    source.addEventListener("mail:sent", refreshSoon);
    source.addEventListener("mail:changed", refreshSoon);

    // EventSource reconnects by itself; what it cannot do is catch up on what
    // it missed while away, so ask for the current state on the way back.
    source.addEventListener("open", refreshSoon);

    return () => {
      if (pending.current) clearTimeout(pending.current);
      source.removeEventListener("mail:received", onReceived);
      source.removeEventListener("mail:sent", refreshSoon);
      source.removeEventListener("mail:changed", refreshSoon);
      source.removeEventListener("open", refreshSoon);
      source.close();
    };
  }, [router]);

  return null;
}
