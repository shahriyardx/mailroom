/**
 * The bits every bulk email carries whether its writer remembered them or not.
 *
 * Pure functions, so the rules about what a campaign must contain are testable
 * without a database behind them. Both senders — one-off campaigns and
 * automations — go through here, because two copies of "what the law requires
 * at the bottom of the email" is one copy too many.
 */

/** Somebody a message is about to be addressed to. */
export interface MergePerson {
  address: string;
  name: string | null;
  /** Whatever else the import, the API or a Set a field box put on them. */
  fields?: Record<string, string> | null;
}

/**
 * Placeholders left for the footer to deal with rather than blanked here.
 *
 * `merge` runs before `withFooter`, and an unknown placeholder becomes empty
 * — so without this the unsubscribe link would be erased on the way past and
 * the footer would have nothing left to replace.
 */
const RESERVED = new Set(["unsubscribe"]);

/** When a field is missing and the writer named no fallback. */
const FALLBACKS: Record<string, string> = {
  /*
   * Not the address. "Hi pat@example.com," is the single most recognisable
   * sign of a mail merge going wrong, and it is worse than not using a name
   * at all — which is what this says instead.
   */
  name: "there",
};

/**
 * `Plan Name`, `plan_name` and `planname` are the same field.
 *
 * Merge fields come from whatever header a CSV exported from somewhere else
 * happened to carry, and nobody writing a subject line wants to reproduce its
 * capitalisation exactly. Matched the same way the importer reads a header.
 */
function fieldKey(name: string) {
  return name.toLowerCase().replace(/[\s_-]/g, "");
}

/** `{{field}}`, or `{{field|what to say when it is empty}}`. */
const PLACEHOLDER = /\{\{\s*([\w .-]+?)\s*(?:\|([^}]*))?\}\}/g;

/**
 * Fills a subject or a body in for one person.
 *
 * Every field on them is available, not only their name and address: a plan, a
 * city, an order number — whatever the import carried or an automation set.
 * An unknown field becomes the fallback after the `|`, or nothing at all. It
 * is never left on screen as `{{plan}}`, because that reaches the reader.
 *
 * `html` escapes what is substituted. Field values arrive from CSV files and
 * from API calls, and a value with a `<` in it must not be able to close a tag
 * in an email that has already been sent to a few thousand people.
 */
export function merge(template: string, person: MergePerson, html = false): string {
  const bag = new Map<string, string>();
  for (const [name, value] of Object.entries(person.fields ?? {})) {
    if (typeof value === "string" && value.trim()) bag.set(fieldKey(name), value.trim());
  }
  // The columns win over a field of the same name: those are the real ones.
  bag.set("address", person.address);
  if (person.name?.trim()) bag.set("name", person.name.trim());

  return template.replace(PLACEHOLDER, (whole, rawName: string, rawFallback?: string) => {
    const key = fieldKey(rawName);
    if (RESERVED.has(key)) return whole;
    const value = bag.get(key) ?? rawFallback?.trim() ?? FALLBACKS[key] ?? "";
    return html ? escapeHtml(value) : value;
  });
}

/** The few characters that would otherwise break out of an attribute or a tag. */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface FooterParts {
  unsubscribeUrl: string;
  /**
   * Where the sender physically is.
   *
   * US CAN-SPAM requires a valid postal address in commercial mail, and
   * Gmail's bulk sender rules lean on the same thing. Empty is allowed here
   * because blocking somebody's send over a settings field they have not
   * filled in yet is not this function's decision — the screens that create
   * campaigns say so instead.
   */
  postalAddress?: string | null;
}

/**
 * Adds the way out, and the address, to the bottom of a body.
 *
 * A writer who put `{{unsubscribe}}` somewhere gets the URL exactly there and
 * no block of ours appended — they have said where they want it. The postal
 * address is still added, because that one is not a matter of taste.
 */
export function withFooter(body: string, parts: FooterParts, html: boolean): string {
  const address = parts.postalAddress?.trim() || "";
  const placed = body.includes("{{unsubscribe}}");
  const withLink = placed ? body.replaceAll("{{unsubscribe}}", parts.unsubscribeUrl) : body;

  if (!html) {
    const lines = [withLink];
    if (!placed) lines.push("", "---", `Unsubscribe: ${parts.unsubscribeUrl}`);
    if (address) lines.push("", address.replace(/\s*\n\s*/g, ", "));
    return lines.join("\n");
  }

  const pieces: string[] = [withLink];
  if (!placed || address) {
    const rows: string[] = [];
    if (!placed) {
      rows.push(
        `<a href="${escapeHtml(parts.unsubscribeUrl)}" style="color:#6b7280">Unsubscribe from these emails</a>`,
      );
    }
    // The address stays on its own line: it is meant to be read, not skimmed
    // past as part of the same sentence as the unsubscribe link.
    if (address) rows.push(escapeHtml(address).replace(/\n/g, "<br>"));
    pieces.push(
      `<p style="margin-top:32px;font-size:12px;line-height:1.6;color:#6b7280">${rows.join("<br><br>")}</p>`,
    );
  }

  return pieces.join("");
}
