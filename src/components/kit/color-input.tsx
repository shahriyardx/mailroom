"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/kit/popover";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

/**
 * A colour, picked properly.
 *
 * The browser's own `<input type="color">` opens the operating system's
 * dialog, which is a different shape on every machine, ignores every token in
 * this app and cannot be told about the colours already in use. This is the
 * same three controls — a square, a hue rail and a hex box — drawn here, plus
 * the shortcuts somebody actually reaches for.
 */

/** The greys and hues an email is usually built from. */
export const SWATCHES = [
  "#000000",
  "#18181b",
  "#3f3f46",
  "#71717a",
  "#a1a1aa",
  "#d4d4d8",
  "#f4f4f5",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
] as const;

export function ColorInput({
  value,
  onChange,
  onCommit,
  fallback = "#000000",
  className,
  trigger,
  align = "start",
  keepFocus = false,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  /**
   * Called when a choice is finished rather than while it is being made: a
   * drag ends, a swatch is pressed, a hex is typed and left. For the callers
   * that must not act on every pixel of a drag.
   */
  onCommit?: (value: string) => void;
  /** Shown when nothing is set: the colour this would be anyway. */
  fallback?: string;
  className?: string;
  /** Something other than the swatch-and-hex box to open it with. */
  trigger?: React.ReactNode;
  align?: "start" | "center" | "end";
  /**
   * Leave the focus where it was. For the text toolbar, where taking it would
   * throw away the selection the colour is meant to apply to.
   */
  keepFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = normalise(value) ?? normalise(fallback) ?? "#000000";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-card pl-1.5 text-left transition-colors hover:border-foreground/20",
              className,
            )}
          >
            <Chip colour={value ? current : null} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate pr-2 font-mono text-[12px]",
                !value && "text-muted-foreground",
              )}
            >
              {value || fallback}
            </span>
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent
        align={align}
        className="w-[232px] p-3"
        onOpenAutoFocus={(event) => keepFocus && event.preventDefault()}
        onCloseAutoFocus={(event) => keepFocus && event.preventDefault()}
        // Applying a colour to a selection means focusing what holds it, and
        // that is outside this layer — which would otherwise close it every
        // time somebody picked something. A press outside still closes it;
        // the focus moving does not.
        onFocusOutside={(event) => keepFocus && event.preventDefault()}
      >
        <Picker value={current} onChange={onChange} onCommit={onCommit} />
      </PopoverContent>
    </Popover>
  );
}

/** The swatch itself, on a checkerboard so "nothing set" is not a white box. */
function Chip({ colour }: { colour: string | null }) {
  return (
    <span className="size-5 shrink-0 overflow-hidden rounded border border-border bg-[repeating-conic-gradient(rgba(127,127,127,0.25)_0_25%,transparent_0_50%)] bg-[length:8px_8px]">
      <span className="block size-full" style={{ backgroundColor: colour ?? "transparent" }} />
    </span>
  );
}

function Picker({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
}) {
  /*
   * Hue, saturation and value are held here rather than read back out of the
   * colour every time, because the conversion is lossy at the edges: black is
   * every hue at once, and so is white. Reading them back meant that dragging
   * the hue rail from black produced black, whatever hue it was dragged to —
   * a slider that visibly did nothing.
   */
  const [hsv, setHsv] = useState(() => toHsv(value));
  const [text, setText] = useState(value);
  const [typing, setTyping] = useState(false);
  const latest = useRef(value);

  // A colour set from outside — a swatch, a hex, another block being selected
  // — re-seeds the three. A colour this picker produced does not, or the
  // drag would fight the thing it is driving.
  useEffect(() => {
    if (fromHsv(hsv[0], hsv[1], hsv[2]) !== value) setHsv(toHsv(value));
    latest.current = value;
  }, [value, hsv]);

  const [hue, saturation, level] = hsv;
  const shown = typing ? text : value;

  function set(next: [number, number, number]) {
    setTyping(false);
    setHsv(next);
    const colour = fromHsv(next[0], next[1], next[2]);
    latest.current = colour;
    onChange(colour);
  }

  function commit() {
    onCommit?.(latest.current);
  }

  return (
    <div className="space-y-2.5">
      <Field
        className="h-[132px] rounded-lg"
        style={{
          backgroundColor: `hsl(${hue} 100% 50%)`,
          backgroundImage:
            "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
        }}
        x={saturation}
        y={1 - level}
        onMove={(x, y) => set([hue, x, 1 - y])}
        onDone={commit}
      >
        <span
          className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute size-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{
            left: `${saturation * 100}%`,
            top: `${(1 - level) * 100}%`,
            backgroundColor: value,
          }}
        />
      </Field>

      <Field
        className="h-3 rounded-full"
        style={{
          backgroundImage:
            "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
        }}
        x={hue / 360}
        y={0.5}
        // Black and white have no hue to change, so moving this rail from one
        // of them means "that hue" rather than "the same nothing".
        onMove={(x) => set([x * 360, saturation || 1, level || 1])}
        onDone={commit}
      >
        <span
          className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 size-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{
            left: `${(hue / 360) * 100}%`,
            backgroundColor: `hsl(${hue} 100% 50%)`,
          }}
        />
      </Field>

      <div className="flex items-center gap-2">
        <Chip colour={value} />
        <input
          value={shown}
          onChange={(event) => {
            setTyping(true);
            setText(event.target.value);
            const parsed = normalise(event.target.value);
            if (parsed) {
              latest.current = parsed;
              setHsv(toHsv(parsed));
              onChange(parsed);
            }
          }}
          onBlur={() => {
            setTyping(false);
            commit();
          }}
          spellCheck={false}
          aria-label="Hex colour"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
        />
      </div>

      <div className="grid grid-cols-8 gap-1">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            onClick={() => {
              setTyping(false);
              setHsv(toHsv(swatch));
              latest.current = swatch;
              onChange(swatch);
              onCommit?.(swatch);
            }}
            className={cn(
              "size-[22px] rounded-md border transition-transform hover:scale-110",
              value.toLowerCase() === swatch ? "border-ring" : "border-border/60",
            )}
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A surface you drag on.
 *
 * Pointer capture rather than listeners on the window: the drag keeps
 * reporting when the finger leaves the box, and it ends by itself if the
 * browser takes the pointer away — which a window listener has to be told
 * about and usually is not.
 */
function Field({
  className,
  style,
  x,
  y,
  onMove,
  onDone,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  onDone?: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function report(event: React.PointerEvent) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    onMove(
      Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    );
  }

  return (
    <div
      ref={ref}
      // A slider by behaviour; the value it carries is a colour, which no
      // single number describes, so the label says what is being dragged.
      role="slider"
      aria-label="Colour"
      aria-valuenow={Math.round(x * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.1 : 0.02;
        if (event.key === "ArrowLeft") onMove(Math.max(0, x - step), y);
        if (event.key === "ArrowRight") onMove(Math.min(1, x + step), y);
        if (event.key === "ArrowUp") onMove(x, Math.max(0, y - step));
        if (event.key === "ArrowDown") onMove(x, Math.min(1, y + step));
      }}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        report(event);
      }}
      onPointerMove={(event) => dragging.current && report(event)}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onDone?.();
      }}
      onKeyUp={() => onDone?.()}
      className={cn(
        "relative cursor-crosshair touch-none outline-none focus:ring-2 focus:ring-ring",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

/** Anything a person might type, as `#rrggbb`, or nothing if it is not one. */
export function normalise(value: string | undefined | null): string | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();

  const short = /^#?([0-9a-f]{3})$/.exec(raw);
  if (short) {
    const [r, g, b] = short[1]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  const long = /^#?([0-9a-f]{6})$/.exec(raw);
  if (long) return `#${long[1]}`;

  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(raw);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  return null;
}

/** Hue in degrees, then saturation and value, each 0 to 1. */
function toHsv(hex: string): [number, number, number] {
  const value = normalise(hex) ?? "#000000";
  const r = Number.parseInt(value.slice(1, 3), 16) / 255;
  const g = Number.parseInt(value.slice(3, 5), 16) / 255;
  const b = Number.parseInt(value.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;

  let hue = 0;
  if (span !== 0) {
    if (max === r) hue = ((g - b) / span) % 6;
    else if (max === g) hue = (b - r) / span + 2;
    else hue = (r - g) / span + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return [hue, max === 0 ? 0 : span / max, max];
}

function fromHsv(hue: number, saturation: number, value: number): string {
  const chroma = value * saturation;
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = value - chroma;

  const [r, g, b] =
    hue < 60
      ? [chroma, second, 0]
      : hue < 120
        ? [second, chroma, 0]
        : hue < 180
          ? [0, chroma, second]
          : hue < 240
            ? [0, second, chroma]
            : hue < 300
              ? [second, 0, chroma]
              : [chroma, 0, second];

  return `#${[r, g, b]
    .map((part) =>
      Math.round((part + base) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
