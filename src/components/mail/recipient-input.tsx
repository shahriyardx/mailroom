"use client";

import {
  type EmailAddress,
  formatAddress,
  isEmailAddress,
  parseAddress,
  splitRecipients,
} from "@/lib/mail";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Entry extends EmailAddress {
  key: string;
  valid: boolean;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
}

let counter = 0;

function nextKey() {
  counter += 1;
  return `rcpt_${counter}`;
}

function toEntry(raw: string): Entry | null {
  const trimmed = raw.trim().replace(/[,;]+$/, "");
  if (!trimmed) return null;
  const parsed = parseAddress(trimmed);
  return {
    ...parsed,
    key: nextKey(),
    valid: isEmailAddress(parsed.address),
  };
}

export function RecipientInput({ value, onChange, placeholder, ariaLabel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<Entry[]>(() =>
    splitRecipients(value)
      .map(toEntry)
      .filter((entry): entry is Entry => entry !== null),
  );

  // Track what we last pushed upward so an echoed prop does not rebuild chips
  // (which would drop invalid entries and reset the keys mid-edit).
  const emitted = useRef(value);

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setEntries(
      splitRecipients(value)
        .map(toEntry)
        .filter((entry): entry is Entry => entry !== null),
    );
  }, [value]);

  const publish = useCallback(
    (next: Entry[]) => {
      setEntries(next);
      const serialized = next.map((entry) => formatAddress(entry)).join(", ");
      emitted.current = serialized;
      onChange(serialized);
    },
    [onChange],
  );

  const addresses = useMemo(() => new Set(entries.map((entry) => entry.address)), [entries]);

  const commit = useCallback(
    (text: string) => {
      const added = splitRecipients(text)
        .map(toEntry)
        .filter((entry): entry is Entry => entry !== null)
        .filter((entry) => {
          if (addresses.has(entry.address)) return false;
          addresses.add(entry.address);
          return true;
        });

      if (added.length > 0) publish([...entries, ...added]);
      setDraft("");
    },
    [entries, addresses, publish],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const key = event.key;

    if (key === "Enter" || key === "," || key === ";") {
      event.preventDefault();
      commit(draft);
      return;
    }

    // A space only ends the address once it actually looks like one.
    if (key === " " && draft.includes("@") && !draft.includes("<")) {
      event.preventDefault();
      commit(draft);
      return;
    }

    if (key === "Tab" && draft.trim()) {
      event.preventDefault();
      commit(draft);
      return;
    }

    // Backspace on an empty field pulls the last chip back for editing,
    // so a second Backspace deletes it character by character.
    if (key === "Backspace" && draft === "" && entries.length > 0) {
      event.preventDefault();
      const last = entries[entries.length - 1]!;
      publish(entries.slice(0, -1));
      setDraft(formatAddress(last));
    }
  }

  function onPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    commit(draft ? `${draft},${text}` : text);
  }

  function remove(key: string) {
    publish(entries.filter((entry) => entry.key !== key));
    inputRef.current?.focus();
  }

  return (
    <div
      className="flex min-h-9 w-full flex-wrap items-center gap-1 py-1.5"
      onClick={() => inputRef.current?.focus()}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === "Enter") {
          inputRef.current?.focus();
        }
      }}
    >
      {entries.map((entry) => (
        <span
          key={entry.key}
          title={formatAddress(entry)}
          className={cn(
            "flex max-w-full items-center gap-1 rounded-sm border py-px pr-1 pl-1.5 font-mono text-[11px]",
            entry.valid
              ? "border-border bg-secondary text-secondary-foreground"
              : "border-destructive/60 border-dashed bg-destructive/10 text-destructive",
          )}
        >
          <span className="truncate">{entry.name ?? entry.address}</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              remove(entry.key);
            }}
            aria-label={`Remove ${entry.address}`}
            className="shrink-0 rounded-[2px] text-muted-foreground hover:text-destructive"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      <input
        ref={inputRef}
        value={draft}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => commit(draft)}
        placeholder={entries.length === 0 ? placeholder : ""}
        className="h-6 min-w-32 flex-1 bg-transparent font-mono text-[12px] outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
