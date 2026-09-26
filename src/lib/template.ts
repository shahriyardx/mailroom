/**
 * Filling the holes in a saved subject and body.
 *
 * Deliberately small. This is not a programming language: it substitutes
 * values, it does not loop, branch or call anything. A template that needs
 * logic is a template that has quietly become code, and code belongs in the
 * service that is sending, where it can be reviewed and tested.
 *
 *   {{ name }}      the value, with HTML escaped
 *   {{{ name }}}    the value as it is, for a value that is already markup
 *   {{ user.name }} a path into a nested object
 */

/** Matches both forms, with the triple first so it wins. */
const PLACEHOLDER = /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g;

export type TemplateData = Record<string, unknown>;

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly missing: string[] = [],
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

/** Every name a template asks for, in the order it first asks. */
export function templateVariables(...sources: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    for (const match of source.matchAll(PLACEHOLDER)) {
      const name = match[1] ?? match[2];
      if (name) found.add(name);
    }
  }
  return [...found];
}

/**
 * Substitutes into one string.
 *
 * A name with no value is an error rather than an empty string. "Hi ," going
 * out to a customer is worse than a 422 telling the caller what it forgot,
 * and an empty string is indistinguishable from a value that really was
 * empty, so there is no chance to notice later.
 */
export function renderTemplate(source: string, data: TemplateData, escapes = true): string {
  const missing: string[] = [];

  const out = source.replace(PLACEHOLDER, (_whole, raw?: string, escaped?: string) => {
    const name = raw ?? escaped ?? "";
    const value = lookUp(data, name);

    if (value === undefined || value === null) {
      missing.push(name);
      return "";
    }

    const text = stringify(value);
    // The triple form is the caller saying "this is markup already". The
    // double form is everything else, and everything else gets escaped:
    // an address or a name arriving from a form must not be able to write
    // tags into an email that goes out under your domain.
    return escapes && escaped !== undefined ? escapeHtml(text) : text;
  });

  if (missing.length > 0) {
    const unique = [...new Set(missing)];
    throw new TemplateError(
      `The template needs ${unique.length === 1 ? "a value" : "values"} for ${unique.join(", ")}`,
      unique,
    );
  }

  return out;
}

/** Subject, HTML and text together, so one missing value reports once. */
export function renderTemplateParts(
  parts: { subject: string; html?: string | null; text?: string | null },
  data: TemplateData,
) {
  const missing = new Set<string>();

  const attempt = (source: string | null | undefined, escapes: boolean) => {
    if (source === null || source === undefined) return null;
    try {
      return renderTemplate(source, data, escapes);
    } catch (error) {
      if (error instanceof TemplateError) {
        for (const name of error.missing) missing.add(name);
        return null;
      }
      throw error;
    }
  };

  const subject = attempt(parts.subject, false);
  const html = attempt(parts.html, true);
  const text = attempt(parts.text, false);

  if (missing.size > 0) {
    const names = [...missing];
    throw new TemplateError(
      `The template needs ${names.length === 1 ? "a value" : "values"} for ${names.join(", ")}`,
      names,
    );
  }

  return { subject: subject ?? "", html, text };
}

/** "user.name" into the object, without evaluating anything. */
function lookUp(data: TemplateData, path: string): unknown {
  let current: unknown = data;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    // Only the object's own keys: "constructor" and friends are not data.
    if (!Object.hasOwn(current as object, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
