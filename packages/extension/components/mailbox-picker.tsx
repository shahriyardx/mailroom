import { cx } from "@/lib/format";
import type { ApiMailbox } from "@/lib/types";
import { Check, ChevronDown, Layers } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Which addresses the list is showing.
 *
 * A menu of our own rather than a `<select>`: the browser draws that one
 * itself, in the operating system's colours, at the operating system's size —
 * a grey slab in the middle of a dark popup. This one can carry each
 * mailbox's colour and show which is chosen, which is the whole point of it.
 */

interface Props {
  mailboxes: ApiMailbox[];
  /** Empty means every address the key reaches. */
  chosen: string[];
  onChoose: (ids: string[]) => void;
}

export function MailboxPicker({ mailboxes, chosen, onChoose }: Props) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // A menu that stays open when you click away is a menu you have to fight.
  useEffect(() => {
    if (!open) return;

    const away = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);

  const only = chosen.length === 1 ? mailboxes.find((box) => box.id === chosen[0]) : null;
  const label = only ? only.address : "All mailboxes";

  function pick(ids: string[]) {
    onChoose(ids);
    setOpen(false);
  }

  return (
    <div ref={wrapper} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        className={cx(
          "flex h-7 max-w-[180px] items-center gap-1.5 rounded-[8px] px-1.5 text-[12px] transition",
          open ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent",
        )}
      >
        <Dot color={only?.color} />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown
          className={cx("size-3.5 shrink-0 opacity-60 transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+4px)] z-40 max-h-[320px] w-[248px] animate-fade-in overflow-y-auto rounded-[11px] border border-border bg-popover p-1 shadow-pop"
        >
          <Row
            label="All mailboxes"
            hint={`Every address the key reaches — ${mailboxes.length} today`}
            selected={chosen.length !== 1}
            onClick={() => pick([])}
          />

          <div className="my-1 h-px bg-border" />

          {mailboxes.map((mailbox) => (
            <Row
              key={mailbox.id}
              label={mailbox.address}
              hint={mailbox.display_name ?? undefined}
              color={mailbox.color}
              selected={chosen.length === 1 && chosen[0] === mailbox.id}
              onClick={() => pick([mailbox.id])}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  hint,
  color,
  selected,
  onClick,
}: {
  label: string;
  hint?: string;
  color?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition",
        selected ? "bg-primary-soft text-primary-soft-foreground" : "hover:bg-accent",
      )}
    >
      <Dot color={color} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12px] leading-[17px]">{label}</span>
        {hint ? (
          <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
        ) : null}
      </span>
      {selected ? <Check className="size-3.5 shrink-0" /> : null}
    </button>
  );
}

/** A mailbox's own colour, or the stack that stands for all of them. */
function Dot({ color }: { color?: string }) {
  if (!color) return <Layers className="size-3.5 shrink-0 opacity-70" />;
  return (
    <span
      className="size-2.5 shrink-0 rounded-full ring-2 ring-inset ring-black/5"
      style={{ backgroundColor: color }}
    />
  );
}
