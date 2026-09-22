import { cx, hueFor, initialsFor } from "@/lib/format";
import { Loader2 } from "lucide-react";
import type React from "react";

/**
 * The handful of controls the popup is built from.
 *
 * A deliberate miniature of src/components/kit: the same variants, the same
 * radii, the same one accent that only ever means state. Radix is not here —
 * nothing in the popup needs a portal or focus trap, and a dependency that
 * exists to solve those would be paying for nothing.
 */

/* ------------------------------------------------------------------ button */

const BUTTON_VARIANTS = {
  solid: "bg-primary text-primary-foreground hover:brightness-110",
  soft: "bg-primary-soft text-primary-soft-foreground hover:brightness-[0.97]",
  outline: "border border-border bg-transparent hover:bg-accent",
  ghost: "bg-transparent hover:bg-accent text-foreground",
  danger: "bg-destructive text-destructive-foreground hover:brightness-110",
} as const;

const BUTTON_SIZES = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5",
  md: "h-8 px-3 text-[13px] gap-1.5",
  lg: "h-9 px-4 text-[13.5px] gap-2",
} as const;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  pill?: boolean;
  busy?: boolean;
}

export function Button({
  variant = "soft",
  size = "md",
  pill = false,
  busy = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-medium transition",
        "disabled:pointer-events-none disabled:opacity-45",
        "[&_svg]:size-[15px] [&_svg]:shrink-0",
        pill ? "rounded-full" : "rounded-[9px]",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {busy ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  );
}

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  tone?: "default" | "danger";
}

/** A square action. The label is the tooltip and the accessible name both. */
export function IconButton({
  label,
  active = false,
  tone = "default",
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={cx(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] transition",
        "disabled:pointer-events-none disabled:opacity-35",
        "[&_svg]:size-[15px]",
        active
          ? "bg-primary-soft text-primary-soft-foreground"
          : tone === "danger"
            ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ inputs */

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-9 w-full rounded-[9px] border border-input bg-card px-3 text-[13px]",
        "placeholder:text-muted-foreground focus:border-ring focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

interface FieldProps {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[12.5px] font-medium">{label}</span>
      {children}
      {error ? (
        <span className="block text-[12px] text-destructive">{error}</span>
      ) : hint ? (
        <span className="block text-[12px] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}

export function Switch({ checked, onChange, label, hint }: SwitchProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        {hint ? <div className="text-[12px] text-muted-foreground">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-4 rounded-full bg-white transition-all",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

interface ChoiceProps<T extends string | number> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}

/**
 * A row of options, one of which is on.
 *
 * Used where a `<select>` would otherwise be. A native select opens a list the
 * operating system draws, in its own colours and its own size, which in a
 * small dark panel arrives as a grey slab from somewhere else entirely. With
 * a handful of options there is no reason to hide them in the first place.
 */
export function Choice<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: ChoiceProps<T>) {
  return (
    <div className="flex flex-wrap gap-1 rounded-[10px] border border-input bg-muted/50 p-1">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-label={`${label}: ${option.label}`}
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cx(
              "min-w-0 flex-1 rounded-[7px] px-2 py-1 text-[12px] font-medium transition",
              on
                ? "bg-card text-foreground shadow-raise"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ avatar */

const AVATAR_SIZES = {
  sm: "size-7 text-[11px]",
  md: "size-8 text-[11.5px]",
  lg: "size-9 text-[12.5px]",
} as const;

interface AvatarProps {
  name?: string | null;
  address?: string | null;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
}

export function Avatar({ name, address, size = "md", className }: AvatarProps) {
  const hue = hueFor((address || name || "?").toLowerCase());
  return (
    <span
      aria-hidden
      className={cx(
        "flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        AVATAR_SIZES[size],
        className,
      )}
      style={{
        backgroundColor: `oklch(0.93 0.045 ${hue})`,
        color: `oklch(0.42 0.13 ${hue})`,
      }}
    >
      {initialsFor(name, address)}
    </span>
  );
}

/* ------------------------------------------------------------- odds and ends */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-4 animate-spin text-muted-foreground", className)} />;
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-12 text-center">
      {icon ? <div className="mb-1 text-muted-foreground [&_svg]:size-7">{icon}</div> : null}
      <div className="text-[14px] font-semibold">{title}</div>
      {body ? <div className="text-[12.5px] text-muted-foreground">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** A coloured dot and a name, for a label chip. */
export function LabelChip({
  name,
  color,
  onRemove,
}: {
  name: string;
  color: string;
  onRemove?: () => void;
}) {
  return (
    <span
      className="pill border-transparent font-medium"
      style={{ backgroundColor: `${color}1f`, color }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="-mr-0.5 ml-0.5 opacity-60 hover:opacity-100"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

/** Rows of grey while the real thing is on its way. */
export function RowSkeleton() {
  return (
    <div className="flex gap-3 px-3 py-2.5">
      <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
      <div className="min-w-0 flex-1 space-y-1.5 py-0.5">
        <div className="h-2.5 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
