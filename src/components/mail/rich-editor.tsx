"use client";

import { IconButton, Separator } from "@/components/kit";
import { cn } from "@/lib/utils";
import {
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

  useEffect(() => {
    const node = ref.current;
    if (node && node.innerHTML !== value) node.innerHTML = value;
  }, [value]);

  function exec(command: string, argument?: string) {
    ref.current?.focus();
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
