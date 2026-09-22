import { FRAME_STYLES } from "@/lib/sanitize";
import { useEffect, useRef, useState } from "react";

/**
 * A message body, drawn inside a sandboxed iframe and sized to its contents.
 *
 * `allow-same-origin` is granted and `allow-scripts` is not, the same pair the
 * web app uses. Without same-origin the parent cannot read `contentDocument`
 * and every message would collapse to a fixed guess at its height; without
 * scripts nothing in the mail can run, which is the half that matters. A
 * sandbox with both would be a sandbox with neither.
 *
 * The height is measured and applied to the element because a frame that
 * scrolls inside a popup that also scrolls is two scrollbars arguing over one
 * gesture.
 */

/** When to re-measure. Images and web fonts land after the first paint. */
const SETTLE = [0, 120, 400, 1200];

interface Props {
  html: string;
  dark: boolean;
}

export function EmailFrame({ html, dark }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;

    const document_ = `<!doctype html><html class="${dark ? "dark" : ""}"><head><meta charset="utf-8"><base target="_blank"><style>${FRAME_STYLES}</style></head><body>${html}</body></html>`;

    element.srcdoc = document_;

    let alive = true;
    const observers: ResizeObserver[] = [];
    const timers: number[] = [];

    const measure = () => {
      if (!alive) return;
      const doc = element.contentDocument;
      if (!doc?.body) return;
      // Ceil, because scrollHeight is an integer and a 13px line at 1.55 is
      // almost always a fraction taller than the whole number it reports.
      const tallest = Math.max(
        Math.ceil(doc.body.getBoundingClientRect().height),
        Math.ceil(doc.documentElement.getBoundingClientRect().height),
        doc.body.scrollHeight,
        doc.documentElement.scrollHeight,
      );
      setHeight(Math.max(24, tallest));
    };

    const onLoad = () => {
      measure();
      const doc = element.contentDocument;
      if (!doc) return;

      for (const node of [doc.body, doc.documentElement]) {
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        observers.push(observer);
      }

      doc.fonts?.ready.then(measure).catch(() => {});
      for (const delay of SETTLE) timers.push(window.setTimeout(measure, delay));
    };

    element.addEventListener("load", onLoad);

    return () => {
      alive = false;
      element.removeEventListener("load", onLoad);
      for (const observer of observers) observer.disconnect();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [html, dark]);

  return (
    <iframe
      ref={frame}
      title="Message"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="w-full border-0"
      style={{ height }}
    />
  );
}
