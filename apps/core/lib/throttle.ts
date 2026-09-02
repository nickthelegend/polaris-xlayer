/**
 * A crude per-IP throttle.
 *
 * The read routes are public by design — a quote needs no wallet — but each
 * one costs an RPC call against a shared quota, so an open endpoint is an open
 * invitation to exhaust it. In-memory and per-instance, which is the right
 * size for this: it blunts a script without pretending to be infrastructure.
 */
const HITS = new Map<string, { n: number; until: number }>();

export function throttled(req: Request, limit = 30, windowMs = 60_000): boolean {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  const seen = HITS.get(ip);
  if (!seen || now > seen.until) {
    HITS.set(ip, { n: 1, until: now + windowMs });
    return false;
  }
  seen.n += 1;
  return seen.n > limit;
}
