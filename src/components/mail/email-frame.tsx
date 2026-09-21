"use client";

import { EMAIL_FRAME_STYLES, prepareEmailHtml } from "@/lib/sanitize-email";
import { cn } from "@/lib/utils";
import { ImageOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Props {
  html: string | null;
  text: string | null;
  inlineImages?: Record<string, string>;
}

/**
 * Email bodies render inside an iframe that is allowed to be same-origin but is
 * never allowed to run scripts. Without `allow-same-origin` the parent cannot
 * read `contentDocument`, so the frame could not be measured and every message
 * collapsed to a fixed guess. Scripts stay off, which is what actually matters:
 * no `allow-scripts` means nothing in the message can execute.
 */
export function EmailFrame({ html, text, inlineImages }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  const [showImages, setShowImages] = useState(false);
  const [dark, setDark] = useState(false);

  // The frame cannot see the app's CSS variables, so the theme is mirrored in.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const prepared = useMemo(() => {
    if (!html) return { html: null, blockedImages: 0, ownsBackground: false };
    return prepareEmailHtml(html, { showRemoteImages: showImages, inlineImages, dark });
  }, [html, showImages, inlineImages, dark]);

  /**
   * A newsletter that paints its own page chose those colours together, so it
   * is shown on white in either theme and otherwise left alone. Everything
   * else — which is most mail — is a few paragraphs that inherit whatever the
   * client puts behind them, and those follow the app like the rest of it.
   */
  const ownsColours = prepared.ownsBackground;

  const srcDoc = useMemo(() => {
    const body = prepared.html ?? `<pre>${escapeHtml(text ?? "")}</pre>`;
    const theme = dark && !prepared.ownsBackground ? "dark" : "";
    return `<!doctype html><html class="${theme}"><head><meta charset="utf-8"><base target="_blank"><style>${EMAIL_FRAME_STYLES}</style></head><body>${body}</body></html>`;
  }, [prepared.html, prepared.ownsBackground, text, dark]);

  const measure = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    try {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      const next = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
      if (next > 0) setHeight(Math.min(Math.max(next, 32), 20000));
    } catch {
      // Opaque origin: fall back to a readable default rather than a blank frame.
      setHeight((current) => (current === 0 ? 320 : current));
    }
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    let observer: ResizeObserver | undefined;

    const onLoad = () => {
      measure();
      try {
        const doc = frame.contentDocument;
        if (doc?.body && typeof ResizeObserver !== "undefined") {
          // Images and late layout changes resize the body; follow them.
          observer = new ResizeObserver(measure);
          observer.observe(doc.body);
        }
        for (const image of doc?.images ?? []) {
          image.addEventListener("load", measure, { once: true });
          image.addEventListener("error", measure, { once: true });
        }
      } catch {
        // Nothing to observe on an opaque origin.
      }
    };

    frame.addEventListener("load", onLoad);
    // srcDoc frames can finish before the listener attaches.
    if (frame.contentDocument?.readyState === "complete") onLoad();

    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [measure]);

  // Re-measure when the document itself changes (e.g. images unblocked).
  useEffect(() => {
    const timer = setTimeout(measure, 50);
    return () => clearTimeout(timer);
  }, [measure]);

  return (
    <div>
      {/* Blocking remote images is the protection working, not a fault, so
          this states itself quietly instead of borrowing warning colours. */}
      {prepared.blockedImages > 0 && !showImages && (
        <div className="mb-3 flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <ImageOff className="size-3.5 shrink-0" />
          <span>
            {prepared.blockedImages} remote {prepared.blockedImages === 1 ? "image" : "images"}{" "}
            blocked to stop read tracking.
          </span>
          <button
            type="button"
            onClick={() => setShowImages(true)}
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            Show images
          </button>
        </div>
      )}

      <div className={cn(ownsColours && "overflow-hidden rounded-xl bg-white")}>
        <iframe
          key={srcDoc.length}
          ref={frameRef}
          title="Message body"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcDoc}
          onLoad={measure}
          className="w-full border-0 bg-transparent"
          style={{ height: height || 32 }}
        />
      </div>
    </div>
  );
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
