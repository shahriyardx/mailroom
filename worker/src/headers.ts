/**
 * Reading the headers of an inbound message.
 *
 * Kept apart from the worker entry point so each parser can be exercised
 * against real headers without standing up a Cloudflare runtime: these are
 * regexes over text written by thousands of different senders, and the only
 * way to trust one is to run it against what actually arrives.
 */

type Header = { key: string; value: string };

export function headerValue(headers: Header[], name: string) {
  const lower = name.toLowerCase();
  return headers.find((header) => header.key.toLowerCase() === lower)?.value ?? null;
}

export function headerValues(headers: Header[], name: string) {
  const lower = name.toLowerCase();
  return headers
    .filter((header) => header.key.toLowerCase() === lower)
    .map((header) => header.value);
}

/**
 * Cloudflare puts SPF/DKIM/DMARC verdicts in Authentication-Results, and a
 * message that has been relayed carries one header per hop, so prefer the one
 * Cloudflare wrote: an upstream hop's verdict describes a different delivery.
 *
 * Within that header a mechanism can appear more than once. SPF is checked
 * twice — once against the HELO name and once against the envelope sender —
 * and the HELO check is routinely "none" because a mail server's own hostname
 * rarely publishes SPF. The envelope sender is the result that means anything,
 * so it wins. DKIM appears once per signature, and one valid signature is
 * enough.
 */
function splitAuthSegments(raw: string) {
  const segments: string[] = [];
  let depth = 0;
  let current = "";

  // Comments are parenthesised and can themselves contain a semicolon.
  for (const character of raw) {
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);

    if (character === ";" && depth === 0) {
      segments.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) segments.push(current);
  return segments;
}

export function parseAuthResults(all: string[]) {
  const raw = all.find((value) => /mx\.cloudflare\.net|cloudflare/i.test(value)) ?? all[0];
  if (!raw) return {};

  const results: { method: string; verdict: string; rest: string }[] = [];
  for (const segment of splitAuthSegments(raw)) {
    const match = segment.match(/^\s*(spf|dkim|dmarc)\s*=\s*([a-z]+)/i);
    if (match) {
      results.push({
        method: match[1]!.toLowerCase(),
        verdict: match[2]!.toLowerCase(),
        rest: segment.slice(match[0].length),
      });
    }
  }

  const of = (method: string) => results.filter((result) => result.method === method);

  const spfResults = of("spf");
  const spf =
    spfResults.find((result) => /smtp\.mailfrom/i.test(result.rest))?.verdict ??
    spfResults.find((result) => result.verdict === "pass")?.verdict ??
    spfResults[0]?.verdict ??
    null;

  const dkimResults = of("dkim");
  const dkim =
    dkimResults.find((result) => result.verdict === "pass")?.verdict ??
    dkimResults[0]?.verdict ??
    null;

  return { spf, dkim, dmarc: of("dmarc")[0]?.verdict ?? null };
}

/**
 * The domain that actually handed the message over, which Gmail labels
 * "mailed-by". It is the envelope sender, not the From header: a sender can
 * write anything in From, but the envelope is what SPF is checked against.
 */
export function parseMailedBy(headers: Header[]) {
  const returnPath = headerValue(headers, "return-path")?.replace(/[<>]/g, "").trim();
  if (returnPath?.includes("@")) return returnPath.split("@").pop()!.toLowerCase();

  // A message Cloudflare accepted records the envelope sender it checked.
  const mailfrom = headerValues(headers, "authentication-results")
    .join(" ")
    .match(/smtp\.mailfrom=([^\s;()]+)/i)?.[1];
  if (!mailfrom) return null;
  return (mailfrom.includes("@") ? mailfrom.split("@").pop()! : mailfrom).toLowerCase();
}

/**
 * The domain in the DKIM signature's `d=` tag.
 *
 * A message can carry several signatures — a sending service often signs with
 * its own domain alongside the customer's — so the one that lines up with the
 * From address is preferred. That is the signature that says "this domain
 * stands behind this message" rather than "this relay carried it".
 */
export function parseSignedBy(headers: Header[], fromAddress: string) {
  const domains = headerValues(headers, "dkim-signature")
    .map((value) => value.match(/(?:^|;)\s*d=([^;\s]+)/i)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase().replace(/\.$/, ""));
  if (domains.length === 0) return null;

  const fromDomain = fromAddress.split("@").pop()?.toLowerCase() ?? "";
  const aligned = domains.find(
    (domain) => fromDomain === domain || fromDomain.endsWith(`.${domain}`),
  );
  return aligned ?? domains[0]!;
}

/**
 * How the last hop reached us, read from the newest Received header — the one
 * written by the server that accepted the message. "none" is a real answer
 * worth storing: it means the message crossed the internet in the clear.
 */
export function parseTls(headers: Header[]) {
  const received = headerValues(headers, "received")[0];
  if (!received) return null;

  const version = received.match(/\bversion=(TLS[\w.]+)/i)?.[1];
  if (version) return version.replace(/_/g, ".").toUpperCase();
  if (/\bwith\s+E?SMTPS\b/i.test(received)) return "TLS";
  if (/\bwith\s+E?SMTPA?\b/i.test(received)) return "none";
  return null;
}

export function parseSpamScore(headers: Header[]) {
  const raw = headerValue(headers, "x-spam-score") ?? headerValue(headers, "x-spam-status");
  if (!raw) return null;
  const match = raw.match(/-?\d+(\.\d+)?/);
  return match ? Math.round(Number(match[0])) : null;
}
