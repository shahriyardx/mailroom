export interface EmailAddress {
  name: string | null;
  address: string;
}

/** Parses "Ada <ada@x.com>, bob@y.com" into structured addresses. */
export function parseAddressList(input: string | null | undefined): EmailAddress[] {
  if (!input) return [];
  const out: EmailAddress[] = [];
  let buffer = "";
  let inQuotes = false;
  let inAngle = false;

  for (const char of input) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === "<") inAngle = true;
    if (char === ">") inAngle = false;
    if (char === "," && !inQuotes && !inAngle) {
      out.push(parseAddress(buffer));
      buffer = "";
      continue;
    }
    buffer += char;
  }
  if (buffer.trim()) out.push(parseAddress(buffer));
  return out.filter((entry) => entry.address.includes("@"));
}

export function parseAddress(raw: string): EmailAddress {
  const value = raw.trim();
  const angled = value.match(/^(.*)<([^>]+)>$/);
  if (angled) {
    const name = angled[1]!.trim().replace(/^"|"$/g, "").trim();
    return { name: name || null, address: angled[2]!.trim().toLowerCase() };
  }
  return { name: null, address: value.toLowerCase() };
}

/**
 * Splits typed or pasted recipient text into single addresses.
 *
 * Commas, semicolons and newlines always separate. A space separates only once
 * the buffer holds a complete address, so `Ada Lovelace <ada@x.com>` stays whole
 * while `a@x.com b@y.com` splits. Quoted names and angle brackets are respected.
 */
export function splitRecipients(input: string): string[] {
  const tokens: string[] = [];
  let buffer = "";
  let inQuotes = false;
  let inAngle = false;

  const flush = () => {
    const token = buffer.trim();
    if (token) tokens.push(token);
    buffer = "";
  };

  const looksComplete = () => {
    const token = buffer.trim();
    if (!token) return false;
    if (token.endsWith(">")) return true;
    return token.includes("@") && !token.includes("<");
  };

  for (const char of input) {
    if (char === '"') {
      inQuotes = !inQuotes;
      buffer += char;
      continue;
    }
    if (!inQuotes && char === "<") inAngle = true;
    if (!inQuotes && char === ">") inAngle = false;

    const hard = char === "," || char === ";" || char === "\n" || char === "\r" || char === "\t";
    if (hard && !inQuotes && !inAngle) {
      flush();
      continue;
    }
    if (char === " " && !inQuotes && !inAngle && looksComplete()) {
      flush();
      continue;
    }
    buffer += char;
  }

  flush();
  return tokens;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value: string) {
  return EMAIL_PATTERN.test(value);
}

export function formatAddress(entry: EmailAddress) {
  return entry.name ? `${entry.name} <${entry.address}>` : entry.address;
}

export function displayOf(entry: EmailAddress) {
  return entry.name || entry.address;
}

export function domainOf(address: string) {
  return address.split("@")[1]?.toLowerCase() ?? "";
}

/** Strips a "Re:"/"Fwd:" prefix chain so replies group under one thread subject. */
export function normalizeSubject(subject: string) {
  return subject.replace(/^(\s*(re|fw|fwd|aw|sv|vs|antw)\s*(\[\d+\])?\s*:\s*)+/i, "").trim();
}

export function replySubject(subject: string) {
  const base = normalizeSubject(subject);
  return base ? `Re: ${base}` : "Re:";
}

export function forwardSubject(subject: string) {
  const base = normalizeSubject(subject);
  return base ? `Fwd: ${base}` : "Fwd:";
}

export function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function makeSnippet(text: string | null, html: string | null, length = 220) {
  const source = text?.trim() ? text : html ? htmlToText(html) : "";
  return source.replace(/\s+/g, " ").slice(0, length);
}

export function textToHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/** Builds a quoted reply body, the way a desktop client does. */
export function quoteForReply(options: {
  fromLabel: string;
  sentAt: Date;
  html: string | null;
  text: string | null;
}) {
  const stamp = options.sentAt.toUTCString();
  const body = options.html ?? textToHtml(options.text ?? "");
  return `<br/><br/><div class="mail-quote">On ${stamp}, ${options.fromLabel} wrote:<blockquote>${body}</blockquote></div>`;
}

export function generateMessageId(domain: string) {
  return `<${crypto.randomUUID()}@${domain}>`;
}
