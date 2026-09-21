"use client";

import { html as htmlLanguage } from "@codemirror/lang-html";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useState } from "react";

/**
 * A small HTML editor: highlighting, and nothing else.
 *
 * No line numbers, no fold gutter, no minimap, no active-line stripe. What is
 * being written here is one email body, not a file — the chrome an IDE needs
 * to move around a thousand lines only makes forty look like work.
 */

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Rows of text to show before it scrolls. */
  minRows?: number;
  id?: string;
}

const LINE_HEIGHT = 20;

export function CodeEditor({ value, onChange, placeholder, minRows = 12, id }: Props) {
  const dark = useIsDark();

  // Built once per theme: the editor is recreated when the extension list
  // changes identity, and rebuilding it on every keystroke loses the cursor.
  const extensions = useMemo(
    () => [
      htmlLanguage(),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          fontSize: "12.5px",
          backgroundColor: "transparent",
        },
        "&.cm-focused": { outline: "none" },
        ".cm-content": {
          padding: "10px 12px",
          fontFamily: "var(--font-mono)",
          lineHeight: `${LINE_HEIGHT}px`,
          // Markup is edited character by character; a font that joins two of
          // them into one glyph makes that harder to do accurately.
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
        },
        ".cm-line": { padding: "0" },
        ".cm-gutters": { display: "none" },
        ".cm-scroller": { overflow: "auto" },
        // The app draws the focus ring on the wrapper, so the editor's own
        // selection layer is all that is left to colour.
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor: "color-mix(in oklch, var(--primary) 28%, transparent)",
        },
        ".cm-cursor": { borderLeftColor: "var(--foreground)" },
        ".cm-placeholder": { color: "var(--muted-foreground)" },
      }),
    ],
    [],
  );

  return (
    <div
      id={id}
      // The same soft well every other control in the kit uses, so this does
      // not read as a widget dropped in from somewhere else.
      className="overflow-hidden rounded-[10px] border border-transparent bg-muted transition-[background-color,border-color] duration-150 focus-within:border-border focus-within:bg-card"
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        theme={dark ? "dark" : "light"}
        extensions={extensions}
        minHeight={`${minRows * LINE_HEIGHT + 20}px`}
        maxHeight="26rem"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          autocompletion: false,
          highlightSelectionMatches: false,
          searchKeymap: false,
          foldKeymap: false,
          completionKeymap: false,
          lintKeymap: false,
          closeBrackets: true,
          bracketMatching: true,
          indentOnInput: true,
        }}
      />
    </div>
  );
}

/** The app puts `dark` on the root element; the editor has to be told. */
function useIsDark() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}
