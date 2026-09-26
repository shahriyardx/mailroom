"use client";

import { ColorInput, IconButton, Separator } from "@/components/kit";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/kit/popover";
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
import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  /**
   * Written where it will appear, as on the builder's canvas.
   *
   * The text takes the look of what holds it, and the toolbar floats above
   * it only while somebody is typing, instead of sitting in the block as a
   * strip of buttons and a rule the email will never have.
   */
  inline?: boolean;
}

/** Small contenteditable editor: enough formatting for real mail, no heavy dependency. */
export function RichEditor({ value, onChange, placeholder, className, inline = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  /** Whether the floating toolbar is up. Only an inline editor has one. */
  const [editing, setEditing] = useState(false);

  /*
   * Put away by a press somewhere else, not by the focus leaving.
   *
   * The colour picker takes the focus while it is open, and the toolbar that
   * holds it must not vanish underneath it. Anything inside a popover layer
   * counts as still editing.
   */
  useEffect(() => {
    if (!inline || !editing) return;
    function away(event: PointerEvent) {
      const target = event.target as Element | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      if (target.closest("[data-radix-popper-content-wrapper]")) return;
      setEditing(false);
    }
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [inline, editing]);

  /*
   * What was selected before the picker took the focus.
   *
   * Opening a popover moves the caret out of the editor and the selection is
   * gone by the time a colour is chosen, so colouring would apply to nothing.
   * The range is kept on the way in and put back on the way out.
   */
  const range = useRef<Range | null>(null);

  /** What the picker is showing. The document is only told on a commit. */
  const [colour, setColour] = useState("#000000");

  /*
   * Which buttons are lit.
   *
   * Without it every tool looked the same whether or not it was already
   * applied, so there was no way to tell bold text from plain by looking at
   * the toolbar — and no way to know that pressing Quote again would take the
   * quote off, which is the press people reach for.
   */
  const [on, setOn] = useState<Record<string, boolean>>({});

  /** Reads the formatting under the caret, whenever the caret moves. */
  function readState() {
    const node = ref.current;
    const selection = window.getSelection();
    if (!node || !selection || selection.rangeCount === 0) return;
    // Somebody else's selection is not this editor's business.
    if (!node.contains(selection.getRangeAt(0).commonAncestorContainer)) return;

    const next: Record<string, boolean> = {};
    for (const command of TOGGLES) {
      try {
        next[command] = document.queryCommandState(command);
      } catch {
        // Not every browser answers for every command, and a toolbar that
        // throws is worse than one that says no.
        next[command] = false;
      }
    }
    next.blockquote = enclosedBy(node, selection.anchorNode, "BLOCKQUOTE");
    next.link = enclosedBy(node, selection.anchorNode, "A");
    setOn(next);
  }

  /*
   * The caret moves for reasons that are not events on this element — an
   * arrow key, a click, another editor being focused — so the document is
   * what has to be listened to.
   */
  useEffect(() => {
    const listener = () => readState();
    document.addEventListener("selectionchange", listener);
    return () => document.removeEventListener("selectionchange", listener);
  });

  function remember() {
    const node = ref.current;
    const selection = window.getSelection();
    if (!node || !selection || selection.rangeCount === 0) return;

    const current = selection.getRangeAt(0);
    // Only a selection inside this editor. A caret left somewhere else is not
    // something to put back here.
    range.current = node.contains(current.commonAncestorContainer) ? current : range.current;
  }

  /**
   * Colours what is selected, and keeps hold of it.
   *
   * Applying a colour rewrites the markup underneath: text nodes are split and
   * a span goes in. The range that was saved before that points at nodes which
   * no longer exist, so putting it back a second time selects nothing — which
   * is why the first pick worked and every one after it did not. The live
   * selection is taken again afterwards, so the next pick has something to
   * apply to.
   */
  function applyColour(colour: string) {
    const node = ref.current;
    if (!node) return;

    node.focus();
    if (range.current) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range.current);
    }

    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("foreColor", false, colour);
    onChange(node.innerHTML);
    remember();
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
    readState();
  }

  /**
   * Quote on, or quote off.
   *
   * `formatBlock` only ever sets a block, so pressing Quote a second time did
   * the same thing again and there was no way back out of one except undo.
   * Off means back to a paragraph, which is what the text was before.
   */
  function toggleQuote() {
    exec("formatBlock", on.blockquote ? "p" : "blockquote");
  }

  const toolbar = (
    <>
      <Tool onClick={() => exec("bold")} label="Bold" active={on.bold}>
        <Bold className="size-4" />
      </Tool>
      <Tool onClick={() => exec("italic")} label="Italic" active={on.italic}>
        <Italic className="size-4" />
      </Tool>
      <Tool onClick={() => exec("underline")} label="Underline" active={on.underline}>
        <Underline className="size-4" />
      </Tool>
      <Tool onClick={() => exec("strikeThrough")} label="Strikethrough" active={on.strikeThrough}>
        <Strikethrough className="size-4" />
      </Tool>
      <Separator orientation="vertical" className="mx-1 h-4 self-center" />
      <Tool
        onClick={() => exec("insertUnorderedList")}
        label="Bullet list"
        active={on.insertUnorderedList}
      >
        <List className="size-4" />
      </Tool>
      <Tool
        onClick={() => exec("insertOrderedList")}
        label="Numbered list"
        active={on.insertOrderedList}
      >
        <ListOrdered className="size-4" />
      </Tool>
      <Tool onClick={toggleQuote} label="Quote" active={on.blockquote}>
        <Quote className="size-4" />
      </Tool>
      <Tool
        onClick={() => {
          // Already a link: the press people reach for is the one that
          // takes it off again.
          if (on.link) {
            exec("unlink");
            return;
          }
          const url = window.prompt("Link URL");
          if (url) exec("createLink", url);
        }}
        label={on.link ? "Remove link" : "Insert link"}
        active={on.link}
      >
        <Link2 className="size-4" />
      </Tool>

      {/* Colours what is selected rather than the whole block, which is the
        only way to make one word — or one link — a different colour. The
        selection has to survive the picker opening, so it is put back
        before the colour is applied. */}
      <ColorInput
        value={colour}
        onChange={setColour}
        keepFocus
        // Applied when the choice is finished rather than on every pixel of
        // a drag: each application rewrites the selection, and doing that a
        // hundred times on the way across the square nests a hundred spans
        // and loses what was selected on the first one.
        onCommit={applyColour}
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
    </>
  );

  const editor = (
    <div
      ref={ref}
      contentEditable
      role="textbox"
      tabIndex={0}
      aria-multiline="true"
      aria-label="Message body"
      data-placeholder={placeholder}
      suppressContentEditableWarning
      onInput={(event) => {
        onChange(event.currentTarget.innerHTML);
        readState();
      }}
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
      onFocus={() => inline && setEditing(true)}
      onBlur={(event) => {
        // Tabbing on to something else ends it. A press is handled above.
        const next = event.relatedTarget as Element | null;
        if (inline && next && !next.closest("[data-radix-popper-content-wrapper]")) {
          setEditing(false);
        }
      }}
      onKeyDown={(event) => {
        if (inline && event.key === "Escape") {
          setEditing(false);
          event.currentTarget.blur();
        }
      }}
      className={cn(
        "outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
        inline
          ? "min-h-[1.4em] cursor-text rounded-sm focus:bg-foreground/[0.03]"
          : "min-h-32 flex-1 overflow-y-auto px-3 py-2.5 text-[13px] leading-relaxed [&_a]:text-primary [&_blockquote]:text-muted-foreground",
      )}
    />
  );

  if (inline) {
    return (
      <Popover open={editing}>
        <PopoverAnchor asChild>
          <div className={className}>{editor}</div>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          sideOffset={8}
          className="flex w-auto items-center gap-0.5 p-1"
          // The caret stays in the text: a toolbar that took the focus would
          // take the selection its buttons are meant to act on.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {toolbar}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border px-2 py-1.5">
        {toolbar}
      </div>
      {editor}
    </div>
  );
}

/** The commands whose on-or-off the browser will answer for directly. */
const TOGGLES = [
  "bold",
  "italic",
  "underline",
  "strikeThrough",
  "insertUnorderedList",
  "insertOrderedList",
];

/**
 * Whether the caret sits inside a tag of this name, within this editor.
 *
 * `queryCommandState` has no answer for a blockquote or a link, so those two
 * are read off the tree instead. Stops at the editor, so a block wrapping the
 * whole canvas is never mistaken for formatting in the text.
 */
function enclosedBy(root: Node, from: Node | null, tag: string) {
  let at: Node | null = from;
  while (at && at !== root) {
    if (at.nodeType === 1 && (at as HTMLElement).tagName === tag) return true;
    at = at.parentNode;
  }
  return false;
}

function Tool({
  onClick,
  label,
  active = false,
  children,
}: {
  onClick: () => void;
  label: string;
  /** Lit, because this formatting is already on what is selected. */
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <IconButton
      label={label}
      size="sm"
      aria-pressed={active}
      className={cn(active && "bg-accent text-foreground")}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </IconButton>
  );
}
