/** Cloudflare stores TXT values unquoted; our display values carry quotes. */
export function unquote(value: string) {
  return value.replace(/^"|"$/g, "");
}

/**
 * Merges the required include mechanisms into an existing SPF record.
 * Two SPF records on one name is a hard failure, so the existing record is
 * edited rather than a second one being added. Returns null if the input is
 * not an SPF record at all.
 */
export function mergeSpf(existing: string, required: string[]) {
  const terms = unquote(existing).trim().split(/\s+/);
  if (terms[0]?.toLowerCase() !== "v=spf1") return null;

  const allIndex = terms.findIndex((term) => /^[-~?+]?all$/i.test(term));
  const head = allIndex === -1 ? terms.slice(1) : terms.slice(1, allIndex);
  const tail = allIndex === -1 ? ["~all"] : terms.slice(allIndex);

  const lowered = head.map((term) => term.toLowerCase());
  for (const include of required) {
    if (!lowered.includes(include.toLowerCase())) head.push(include);
  }

  return ["v=spf1", ...head, ...tail].join(" ");
}

export function spfIncludesOf(value: string) {
  return unquote(value)
    .split(/\s+/)
    .filter((term) => term.toLowerCase().startsWith("include:"));
}
