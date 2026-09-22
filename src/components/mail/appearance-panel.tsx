"use client";

import { Panel } from "@/components/kit";
import { cn } from "@/lib/utils";
import { saveAppearanceAction } from "@/server/actions";
import type { Appearance } from "@/server/preferences";
import { Columns2, Monitor, Moon, Rows3, Square, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * How the app looks, chosen once and kept in the database.
 *
 * Every choice here is saved the moment it is made. Nothing is worth an Apply
 * button when you can see the result behind the dialog.
 */
export function AppearancePanel({ initial }: { initial: Appearance }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [, startTransition] = useTransition();

  function set(patch: Partial<Appearance>) {
    const next = { ...value, ...patch };
    setValue(next);

    // The theme is on the document, not in React, so it changes here as well
    // as being written down. The pre-paint script reads the mirror.
    if (patch.theme) applyTheme(patch.theme);

    startTransition(async () => {
      await saveAppearanceAction(patch);
      router.refresh();
    });
  }

  return (
    <>
      <Panel title="Theme" description="Follow the device, or pick one and stay with it.">
        <Choices
          value={value.theme}
          onChange={(theme) => set({ theme })}
          options={[
            { value: "system", label: "System", hint: "Match the device", icon: Monitor },
            { value: "light", label: "Light", hint: "Always light", icon: Sun },
            { value: "dark", label: "Dark", hint: "Always dark", icon: Moon },
          ]}
        />
      </Panel>

      <Panel title="Density" description="How much of the screen a conversation takes up.">
        <Choices
          value={value.density}
          onChange={(density) => set({ density })}
          options={[
            {
              value: "comfortable",
              label: "Comfortable",
              hint: "Sender, subject and a line of the message",
              icon: Rows3,
            },
            {
              value: "compact",
              label: "Compact",
              hint: "Sender and subject only, so more fit",
              icon: Square,
            },
          ]}
        />
      </Panel>

      <Panel title="Reading" description="Where a conversation opens when you pick one.">
        <Choices
          value={value.readingLayout}
          onChange={(readingLayout) => set({ readingLayout })}
          options={[
            {
              value: "split",
              label: "Side by side",
              hint: "The list stays where it is",
              icon: Columns2,
            },
            {
              value: "stacked",
              label: "One at a time",
              hint: "The conversation fills the screen, with a way back",
              icon: Rows3,
            },
          ]}
        />
      </Panel>
    </>
  );
}

/** One row of cards, exactly one of them picked. */
function Choices<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string; hint: string; icon: LucideIcon }[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors",
              active
                ? "border-primary bg-primary-soft text-primary-soft-foreground"
                : "border-border bg-card hover:bg-accent",
            )}
          >
            <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
            <span className="text-[13px] font-medium">{option.label}</span>
            <span className="text-[11.5px] leading-snug text-muted-foreground">{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The document carries the theme, and a copy in local storage lets the
 * pre-paint script get it right before any of this has loaded.
 */
function applyTheme(theme: Appearance["theme"]) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // A browser that refuses storage still gets the change, just not the memory.
  }
}
