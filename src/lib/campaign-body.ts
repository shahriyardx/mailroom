/**
 * The bits every bulk email carries whether its writer remembered them or not.
 *
 * Pure functions, so the rules about what a campaign must contain are testable
 * without a database behind them. Both senders — one-off campaigns and
 * automations — go through here, because two copies of "what the law requires
 * at the bottom of the email" is one copy too many.
 */

/** `{{name}}` and `{{address}}`, filled from the member row. */
export function merge(template: string, person: { address: string; name: string | null }) {
  return template
    .replaceAll("{{address}}", person.address)
    .replaceAll("{{name}}", person.name ?? person.address);
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
