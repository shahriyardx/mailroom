"use client";

import { html as htmlLanguage } from "@codemirror/lang-html";
import { javascript as jsLanguage } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useState } from "react";

/**
 * Code that is read, not written.
 *
 * The same highlighting the template editor uses, with every affordance of
 * an editor taken away: no cursor, no gutters, no keymap. A sample somebody
 * is meant to copy should not look like a box they are meant to fill in.
 */

interface Props {
  code: string;
  language?: "javascript" | "html";
  className?: string;
}

export function CodeBlock({ code, language = "javascript", className }: Props) {
  const dark = useIsDark();

  const extensions = useMemo(
    () => [
      language === "html" ? htmlLanguage() : jsLanguage({ typescript: true }),
      EditorView.lineWrapping,
      EditorView.editable.of(false),
      EditorView.theme({
        // The packaged themes paint their own near-black behind the text,
        // which lands as a second, slightly wrong panel inside the card the
        // app already drew. Only the syntax colours are wanted from them.
        "&, &.cm-editor, .cm-scroller, .cm-content, .cm-gutters": {
          backgroundColor: "transparent",
        },
        "&": { fontSize: "11.5px" },
        "&.cm-focused": { outline: "none" },
        ".cm-content": {
          padding: "0",
          fontFamily: "var(--font-mono)",
          lineHeight: "1.65",
          // A coding font turns => into one arrow glyph and === into three
          // bars. Pretty in an editor, wrong in a sample somebody is copying
          // character by character into their own file.
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
          // Nothing is being typed here, so nothing should look like it is.
          caretColor: "transparent",
        },
        ".cm-line": { padding: "0" },
        ".cm-gutters": { display: "none" },
        ".cm-cursor, .cm-dropCursor": { display: "none" },
        ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
          backgroundColor: "color-mix(in oklch, var(--primary) 26%, transparent)",
        },
        // A sample is read left to right; the active line stripe is noise.
        ".cm-activeLine": { backgroundColor: "transparent" },
      }),
    ],
    [language],
  );

  return (
    <div className={className}>
      <CodeMirror
        value={code}
        readOnly
        editable={false}
        theme={dark ? "dark" : "light"}
        extensions={extensions}
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
          defaultKeymap: false,
          historyKeymap: false,
          closeBrackets: false,
          bracketMatching: false,
          indentOnInput: false,
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
