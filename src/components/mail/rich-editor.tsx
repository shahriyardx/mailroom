"use client";

import { ColorInput, IconButton, Separator } from "@/components/kit";
import { cn } from "@/lib/utils";
import {
  Baseline,
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";
import { useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

/** Small contenteditable editor: enough formatting for real mail, no heavy dependency. */
export function RichEditor({ value, onChange, placeholder, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  /*
   * What was selected before the picker took the focus.
   *
   * Opening a popover moves the caret out of the editor and the selection is
   * gone by the time a colour is chosen, so colouring would apply to nothing.
   * The range is kept on the way in and put back on the way out.
   */
  const range = useRef<Range | null>(null);

  function remember() {
    const selection = window.getSelection();
    range.current = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  }

  function restore() {
    if (!range.current) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range.current);
  }

  useEffect(() => {
    const node = ref.current;
    if (node && node.innerHTML !== value) node.innerHTML = value;
  }, [value]);

  function exec(command: string, argument?: string) {
    ref.current?.focus();
    // Ask for a style rather than a <font> tag, which is what this produces
    // otherwise and which nothing downstream keeps.
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, argument);
    onChange(ref.current?.innerHTML ?? "");
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
        <Tool onClick={() => exec("bold")} label="Bold">
          <Bold className="size-4" />
        </Tool>
        <Tool onClick={() => exec("italic")} label="Italic">
          <Italic className="size-4" />
        </Tool>
        <Tool onClick={() => exec("underline")} label="Underline">
          <Underline className="size-4" />
        </Tool>
        <Tool onClick={() => exec("strikeThrough")} label="Strikethrough">
          <Strikethrough className="size-4" />
        </Tool>
        <Separator orientation="vertical" className="mx-1 h-4 self-center" />
        <Tool onClick={() => exec("insertUnorderedList")} label="Bullet list">
          <List className="size-4" />
        </Tool>
        <Tool onClick={() => exec("insertOrderedList")} label="Numbered list">
          <ListOrdered className="size-4" />
        </Tool>
        <Tool onClick={() => exec("formatBlock", "blockquote")} label="Quote">
          <Quote className="size-4" />
        </Tool>
        <Tool
          onClick={() => {
            const url = window.prompt("Link URL");
            if (url) exec("createLink", url);
          }}
          label="Insert link"
        >
          <Link2 className="size-4" />
        </Tool>

        {/* Colours what is selected rather than the whole block, which is the
            only way to make one word — or one link — a different colour. The
            selection has to survive the picker opening, so it is put back
            before the colour is applied. */}
        <ColorInput
          value={undefined}
          fallback="#000000"
          keepFocus
          onChange={(colour) => {
            restore();
            exec("foreColor", colour);
          }}
          trigger={
            <button
              type="button"
              aria-label="Colour of the selected text"
              // The same bargain the other tools make: the press must not
              // move the caret, or there is nothing left to colour.
              onMouseDown={(event) => {
                event.preventDefault();
                remember();
              }}
              className="ml-0.5 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Baseline className="size-4" />
            </button>
          }
        />
      </div>

      <div
        ref={ref}
        contentEditable
        role="textbox"
        tabIndex={0}
        aria-multiline="true"
        aria-label="Message body"
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        onClickCapture={(event) => {
          // A link here is something being written, not somewhere to go.
          //
          // Caught on the way down and stopped there. Preventing the default
          // is not enough on its own: the router's progress bar watches for
          // clicks on anchors further up, so the page stayed put but the bar
          // still ran across the top as though it were going somewhere.
          if (!(event.target as HTMLElement).closest("a")) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onPaste={(event) => {
          // Paste as plain text so foreign styles never leak into the message.
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
        className="min-h-32 flex-1 overflow-y-auto px-3 py-2.5 text-[13px] leading-relaxed outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
      />
    </div>
  );
}

function Tool({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <IconButton
      label={label}
      size="sm"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </IconButton>
  );
}
