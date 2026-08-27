/**
 * Why part of the ledger is missing, in a sentence, or null when we cannot tell.
 *
 * Kept honest on purpose: the activity feed used to tell every reader that the
 * network was rate limiting us, whatever had actually gone wrong, so a node
 * that had fallen behind sent people off to wait out a limit that was never
 * the problem. An unrecognised failure returns null and the screen says only
 * that the read failed, rather than inventing a cause.
 */
export function describePartial(e: unknown): string | null {
  const raw = String((e as any)?.message ?? e ?? "");
  if (/429|too many requests/i.test(raw)) return "the network is rate limiting us";
  if (/node is behind|behind|unhealthy/i.test(raw)) return "the node is behind";
  if (/failed to fetch|network request failed|econnrefused/i.test(raw)) {
    return "the network could not be reached";
  }
  if (/timed out|timeout/i.test(raw)) return "the network took too long to answer";
  return null;
}
