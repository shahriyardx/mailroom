/**
 * Comparing two released versions.
 *
 * Kept apart from the route that uses it because the answer is only ever
 * noticed when it is wrong: "0.2.10" sorts before "0.2.9" as text, and an
 * instance told it was up to date says nothing at all.
 */

function parts(value: string) {
  return (
    value
      .trim()
      .replace(/^v/, "")
      // A prerelease is read as the release it is heading for. Splitting on
      // the dash instead would make 0.3.0-rc.1 sort above 0.3.0 and nag
      // somebody already running the finished thing.
      .split(/[-+]/)[0]!
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0))
  );
}

/** Is `candidate` a later release than `current`? */
export function isNewer(candidate: string, current: string) {
  const [a, b] = [parts(candidate), parts(current)];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}
