import type { ReactNode } from "react";

/**
 * Colour for the code samples in the documentation.
 *
 * A tokeniser, not a parser. Highlighting a sample is not compiling it: the
 * reader needs the string told apart from the keyword told apart from the
 * comment, and every one of those is a shape a regular expression can see.
 * That buys colour with no editor loaded into the page and no work in the
 * browser at all — these run once, on the server, and arrive as markup.
 *
 * The colours come from the app's own tokens, so a sample sits in the theme
 * rather than carrying a second one in with it.
 */

const COMMENT = "text-muted-foreground italic";
const STRING = "text-ok";
const NUMBER = "text-warn";
const KEYWORD = "text-primary";
const PROPERTY = "text-info";
const TAG = "text-primary";

/** The words worth colouring, across the handful of languages these pages use. */
const KEYWORDS =
  /^(?:const|let|var|function|async|await|return|import|export|from|new|delete|typeof|instanceof|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|class|extends|implements|interface|type|enum|public|private|readonly|static|of|in|as|void|null|undefined|true|false|this|super|yield|def|lambda|elif|with|package|func|go|defer|struct|map|chan|nil|None|True|False|and|or|not|print)$/;

interface Rule {
  pattern: RegExp;
  /** The class for a match, or a function when the match decides it. */
  className: string | ((match: RegExpMatchArray) => string | null);
}

/*
 * One expression per language family, with the tokens that swallow the most
 * text first: a keyword inside a comment is part of the comment, and a
 * bracket inside a string is part of the string.
 */
const RULES: Record<string, Rule> = {
  code: {
    pattern:
      /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|(?<string>`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(?<number>\b\d[\d_]*(?:\.\d+)?\b)|(?<word>[A-Za-z_$][\w$]*)/g,
    className: (match) => {
      const groups = match.groups ?? {};
      if (groups.comment) return COMMENT;
      if (groups.string) {
        // A quoted key is the name of a field, not a value, and reads better
        // told apart from one — which is most of what makes JSON legible.
        const after = match.input?.slice((match.index ?? 0) + match[0].length) ?? "";
        return /^\s*:/.test(after) ? PROPERTY : STRING;
      }
      if (groups.number) return NUMBER;
      if (groups.word && KEYWORDS.test(groups.word)) return KEYWORD;
      return null;
    },
  },

  shell: {
    pattern:
      /(?<comment>#[^\n]*)|(?<string>"(?:\\.|[^"\\])*"|'[^']*')|(?<flag>(?<=\s)--?[A-Za-z][\w-]*)|(?<command>^\s*[a-z][\w.-]*)/gm,
    className: (match) => {
      const groups = match.groups ?? {};
      if (groups.comment) return COMMENT;
      if (groups.string) return STRING;
      if (groups.flag) return PROPERTY;
      if (groups.command) return KEYWORD;
      return null;
    },
  },

  html: {
    pattern:
      /(?<comment><!--[\s\S]*?-->)|(?<tag><\/?[a-zA-Z][\w-]*|\/?>)|(?<attribute>[a-zA-Z-]+(?==))|(?<string>"(?:[^"]*)"|'[^']*')/g,
    className: (match) => {
      const groups = match.groups ?? {};
      if (groups.comment) return COMMENT;
      if (groups.tag) return TAG;
      if (groups.attribute) return PROPERTY;
      if (groups.string) return STRING;
      return null;
    },
  },
};

/** Which set of rules a fence's info string asks for. */
function rulesFor(language: string | undefined): Rule | null {
  const name = (language ?? "").toLowerCase();
  if (!name) return null;
  if (name === "html" || name === "xml" || name === "svg") return RULES.html;
  if (name === "sh" || name === "bash" || name === "shell" || name === "zsh") return RULES.shell;
  if (name === "txt" || name === "text" || name === "log" || name === "http") return null;
  return RULES.code;
}

export function highlight(code: string, language?: string): ReactNode {
  const rule = rulesFor(language);
  if (!rule) return code;

  const out: ReactNode[] = [];
  let last = 0;

  for (const match of code.matchAll(rule.pattern)) {
    const at = match.index ?? 0;
    const className = typeof rule.className === "function" ? rule.className(match) : rule.className;
    if (!className) continue;

    if (at > last) out.push(code.slice(last, at));
    out.push(
      <span key={`t-${at}`} className={className}>
        {match[0]}
      </span>,
    );
    last = at + match[0].length;
  }

  if (last < code.length) out.push(code.slice(last));
  return out;
}
