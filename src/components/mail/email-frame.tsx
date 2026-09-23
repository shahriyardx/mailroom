"use client";

import { EMAIL_FRAME_STYLES, prepareEmailHtml } from "@/lib/sanitize-email";
import { cn } from "@/lib/utils";
import { setImageChoiceAction } from "@/server/actions";
import { Image as ImageIcon, ImageOff, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Props {
  html: string | null;
  text: string | null;
  inlineImages?: Record<string, string>;
  /** Who sent it, so a choice about images can be remembered against them. */
  sender?: string;
  /** What this reader decided about that sender last time. */
  imagesAllowed?: boolean;
  /**
   * Show it the way a client that forces dark mode will.
   *
   * For the builder's preview. Gmail on Android and Outlook on Windows do not
   * ask the message whether it has a dark version — they invert the colours
   * it has and leave the pictures alone. That is what is copied here, because
   * the thing worth finding before a send is the dark logo that has just
   * landed on a dark background.
   */
  forceDark?: boolean;
}

/**
 * Email bodies render inside an iframe that is allowed to be same-origin but is
 * never allowed to run scripts. Without `allow-same-origin` the parent cannot
 * read `contentDocument`, so the frame could not be measured and every message
 * collapsed to a fixed guess. Scripts stay off, which is what actually matters:
 * no `allow-scripts` means nothing in the message can execute.
 */
/** When to look again after a frame loads, in milliseconds. */
const SETTLE = [0, 120, 400, 1200];

export function EmailFrame({
  html,
  text,
  inlineImages,
  sender,
  imagesAllowed = false,
  forceDark = false,
}: Props) {
  const [showImages, setShowImages] = useState(imagesAllowed);
  const [showQuote, setShowQuote] = useState(false);
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
    if (!html) {
      return {
        html: null,
        quoted: null,
        quotedOwnsBackground: false,
        blockedImages: 0,
        remoteImages: 0,
        ownsBackground: false,
      };
    }
    return prepareEmailHtml(html, { showRemoteImages: showImages, inlineImages, dark });
  }, [html, showImages, inlineImages, dark]);

  /**
   * A newsletter that paints its own page designed those colours together, so
   * it is shown on white in either theme and otherwise left alone. Everything
   * else — which is most mail — is a few paragraphs that inherit whatever the
   * client puts behind them, and those follow the app like the rest of it.
   */
  const body = prepared.html ?? `<pre>${escapeHtml(text ?? "")}</pre>`;
  const themed = dark && !prepared.ownsBackground;

  /**
   * A choice made here is a choice about the sender, not about this one
   * message. Saying it again on every message they send is the thing being
   * fixed, so the answer is written down and read back next time.
   */
  function decide(allowed: boolean) {
    setShowImages(allowed);
    if (sender) void setImageChoiceAction(sender, allowed);
  }

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
            onClick={() => decide(true)}
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            {sender ? "Always show from this sender" : "Show images"}
          </button>
        </div>
      )}

      {/* The way back. Without it, one click trusts a sender for good. */}
      {prepared.remoteImages > 0 && showImages && sender && (
        <div className="mb-3 flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <ImageIcon className="size-3.5 shrink-0" />
          <span>Images load from {sender}.</span>
          <button
            type="button"
            onClick={() => decide(false)}
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            Stop loading them
          </button>
        </div>
      )}

      <Frame body={body} themed={themed} onWhite={prepared.ownsBackground} inverted={forceDark} />

      {/*
        A reply carries the whole message it answers, and that message carries
        the one before it. Shown in full, three lines of new writing arrive
        under a wall of things the reader has already read — so the carried
        part folds away, and says so.
      */}
      {prepared.quoted && (
        <>
          <button
            type="button"
            onClick={() => setShowQuote((value) => !value)}
            aria-expanded={showQuote}
            aria-label={showQuote ? "Hide quoted text" : "Show quoted text"}
            className={cn(
              "mt-2 flex h-5 items-center rounded px-1.5 transition-colors",
              showQuote ? "bg-accent text-foreground" : "bg-muted text-muted-foreground",
              "hover:bg-accent hover:text-foreground",
            )}
          >
            <MoreHorizontal className="size-3.5" />
          </button>

          {showQuote && (
            <div className="mt-2">
              <Frame
                body={prepared.quoted}
                themed={dark && !prepared.quotedOwnsBackground}
                onWhite={prepared.quotedOwnsBackground}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One measured iframe. The height follows the document inside it. */
function Frame({
  body,
  themed,
  onWhite,
  inverted = false,
}: {
  body: string;
  themed: boolean;
  onWhite: boolean;
  /** Invert everything but the pictures, the way a forcing client does. */
  inverted?: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);

  /*
   * Inverting twice is how the pictures come back: the page is turned inside
   * out, and every image is turned inside out again inside it. The hue
   * rotation is what keeps a blue link blue rather than making it orange.
   */
  const invert = inverted
    ? "html{background:#0b0b0c;}body{filter:invert(1) hue-rotate(180deg);}img,video{filter:invert(1) hue-rotate(180deg);}"
    : "";

  const srcDoc = useMemo(
    () =>
      `<!doctype html><html class="${themed ? "dark" : ""}"><head><meta charset="utf-8"><base target="_blank"><style>${EMAIL_FRAME_STYLES}${invert}</style></head><body>${body}</body></html>`,
    [body, themed, invert],
  );

  const measure = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    try {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      /**
       * scrollHeight is a whole number, and a body of 13px text at a line
       * height of 1.55 almost never lands on one. Rounded down, the frame is
       * a fraction of a pixel too short for what is inside it, and gives
       * itself a scrollbar over half a line of nothing. Measure the real box
       * and round up.
       */
      const next = Math.ceil(
        Math.max(
          doc.body.getBoundingClientRect().height,
          doc.documentElement.getBoundingClientRect().height,
          doc.body.scrollHeight,
          doc.documentElement.scrollHeight,
        ),
      );
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
    const timers: number[] = [];

    const onLoad = () => {
      measure();
      try {
        const doc = frame.contentDocument;
        if (doc?.body && typeof ResizeObserver !== "undefined") {
          // Images and late layout changes resize the body; follow them.
          observer = new ResizeObserver(measure);
          observer.observe(doc.body);
          // The body's own box can stay put while what is inside it moves, so
          // watch the page as well as the body.
          observer.observe(doc.documentElement);
        }
        for (const image of doc?.images ?? []) {
          image.addEventListener("load", measure, { once: true });
          image.addEventListener("error", measure, { once: true });
        }

        /**
         * A measurement is only as good as the layout it was taken from, and
         * the layout is not final at load: a web font arrives and every line
         * changes height, a pane finishes an animation and the text rewraps.
         * Each of those has left a frame a hundred pixels short with a
         * scrollbar over the rest, so the answer is checked again as the page
         * settles rather than trusted the first time.
         */
        doc?.fonts?.ready.then(measure).catch(() => {});
      } catch {
        // Nothing to observe on an opaque origin.
      }

      for (const delay of SETTLE) timers.push(window.setTimeout(measure, delay));
    };

    frame.addEventListener("load", onLoad);
    // srcDoc frames can finish before the listener attaches.
    if (frame.contentDocument?.readyState === "complete") onLoad();

    /**
     * Narrowing the pane reflows the text taller inside a frame whose height
     * was worked out at the old width. Watching the frame itself catches
     * that, which watching only its contents does not.
     */
    let outer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      outer = new ResizeObserver(measure);
      outer.observe(frame);
    }

    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
      outer?.disconnect();
      for (const timer of timers) clearTimeout(timer);
    };
  }, [measure]);

  // Re-measure when the document itself changes (e.g. images unblocked).
  useEffect(() => {
    const timer = setTimeout(measure, 50);
    return () => clearTimeout(timer);
  }, [measure]);

  return (
    <div className={cn(onWhite && "overflow-hidden rounded-xl bg-white")}>
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
  );
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
