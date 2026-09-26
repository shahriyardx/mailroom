"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/kit/popover";
import { cn } from "@/lib/utils";
import { EmojiPicker } from "frimousse";
import { ChevronDown, X } from "lucide-react";
import { useState } from "react";

/** Served by the app itself: a self-hosted instance may have no CDN to reach. */
const EMOJI_DATA = "/emoji-data";

/**
 * One emoji, picked from all of them.
 *
 * The picker loads the list the first time it opens, then the browser keeps
 * it. Search matches names and tags, so "warn" finds the warning sign.
 */
export function EmojiField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (emoji: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-lg border border-border bg-card px-2 text-left text-[12.5px] transition-colors hover:border-foreground/20",
            className,
          )}
        >
          {value ? (
            <span className="text-[16px] leading-none">{value}</span>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
          <ChevronDown className="ml-auto size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-auto p-0">
        <EmojiPicker.Root
          emojibaseUrl={EMOJI_DATA}
          columns={8}
          onEmojiSelect={({ emoji }) => {
            onChange(emoji);
            setOpen(false);
          }}
          className="isolate flex h-[340px] w-fit flex-col"
        >
          <div className="flex items-center gap-1.5 border-border border-b p-2">
            <EmojiPicker.Search
              autoFocus
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground focus:border-foreground/30"
            />
            {value && (
              <button
                type="button"
                title="No icon"
                aria-label="No icon"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <EmojiPicker.Viewport className="relative flex-1 outline-none">
            <EmojiPicker.Loading className="absolute inset-0 grid place-items-center text-[12px] text-muted-foreground">
              Loading…
            </EmojiPicker.Loading>
            <EmojiPicker.Empty className="absolute inset-0 grid place-items-center text-[12px] text-muted-foreground">
              Nothing found
            </EmojiPicker.Empty>
            <EmojiPicker.List
              className="select-none pb-1.5"
              components={{
                CategoryHeader: ({ category, ...props }) => (
                  <div
                    className="bg-popover px-3 pt-3 pb-1.5 font-medium text-[11px] text-muted-foreground"
                    {...props}
                  >
                    {category.label}
                  </div>
                ),
                Row: ({ children, ...props }) => (
                  <div className="scroll-my-1.5 px-1.5" {...props}>
                    {children}
                  </div>
                ),
                Emoji: ({ emoji, ...props }) => (
                  <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md text-[18px] data-[active]:bg-accent"
                    {...props}
                  >
                    {emoji.emoji}
                  </button>
                ),
              }}
            />
          </EmojiPicker.Viewport>
        </EmojiPicker.Root>
      </PopoverContent>
    </Popover>
  );
}
