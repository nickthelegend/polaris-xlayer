/**
 * Getting a Solana Pay code from the outside world into the scan screen.
 *
 * Two things arrive here, and only one of them is under our control:
 *
 *   solana:http%3A%2F%2F...      a real Solana Pay link, from any camera app,
 *                                browser, or wallet that hands off a payment
 *   polaris://scan?request=...   our own scheme, used by the web build and by
 *                                anything that deep-links straight to the screen
 *
 * The second shape is where this gets sharp. A Solana Pay url is itself
 * url-encoded, so nesting it inside a query parameter encodes it twice — and
 * how many times it is decoded before we see it depends on the platform. On
 * Android the router hands back a value that has already been decoded twice,
 * which turns the inner `%26` back into a literal `&`, and the query parser
 * then splits the link there and drops everything after the first parameter.
 * A six-installment plan arrived as a merchant and nothing else.
 *
 * So the deep link is never parsed as a query string when we can avoid it: a
 * `solana:` url is taken as the whole data uri, stashed here, and the screen
 * picks it up from memory. Nothing round-trips through the router.
 *
 * `extractRequest` is pure, and decodes by result rather than by count: it
 * stops as soon as the payload is a usable http url instead of assuming a
 * fixed number of layers, because that number genuinely differs per platform.
 */

const HTTP = /^https?:\/\//i;
const PERCENT = /%[0-9a-fA-F]{2}/;

/** The payload of a `solana:` url, once it is a url we could actually fetch. */
function usable(candidate: string): boolean {
  if (!candidate.toLowerCase().startsWith("solana:")) return false;
  return HTTP.test(candidate.slice("solana:".length));
}

/**
 * The Solana Pay url inside a deep link, or null if there isn't one.
 *
 * Returned fully decoded: `parseSolanaPayUrl` decodes once more, which is a
 * no-op on a url with no percent escapes left, so the two compose.
 */
export function extractRequest(deepLink: string): string | null {
  const trimmed = deepLink.trim();
  if (!trimmed) return null;

  let candidate: string | null = null;
  if (trimmed.toLowerCase().startsWith("solana:")) {
    candidate = trimmed;
  } else {
    const q = trimmed.indexOf("?");
    if (q >= 0) candidate = new URLSearchParams(trimmed.slice(q + 1)).get("request");
  }

  if (candidate) {
    /*
     * Bounded, and bounded by success rather than by a hard count: decode only
     * while the value still looks encoded and is not yet usable. Decoding a
     * url that is already plain would corrupt any literal percent in it.
     */
    for (let i = 0; i < 4; i += 1) {
      if (usable(candidate)) return candidate;
      if (!PERCENT.test(candidate)) break;
      let next: string;
      try {
        next = decodeURIComponent(candidate);
      } catch {
        break;
      }
      if (next === candidate) break;
      candidate = next;
    }
    if (usable(candidate)) return candidate;
  }

  /*
   * Last shape: a Solana Pay url that lost its scheme on the way in.
   *
   * The router rewrites an incoming `solana:<encoded url>` into the app's own
   * scheme before trying to match it, so it arrives as
   * `polaris://http%253A%252F%252F...`, matches no route, and leaves the
   * borrower on an "Unmatched Route" page holding their payment. The payload
   * is the one part that survives that, so recover it from whatever follows
   * the scheme and rebuild the request around it.
   *
   * Anything that is not an http url once decoded falls through to null, so
   * ordinary routes like `polaris://scan` are untouched.
   */
  let tail = trimmed.replace(/^[a-z0-9+.-]+:(\/\/)?/i, "").replace(/^\/+/, "");
  for (let i = 0; i < 4; i += 1) {
    /*
     * Either shape counts as recovered: a payload that lost its scheme, or a
     * whole `solana:` url that was simply escaped end to end. Testing only the
     * first meant a fully-escaped parameter value decoded all the way to
     * `solana:http://...` and was then thrown away for not looking like a bare
     * http url.
     */
    if (usable(tail)) return tail;
    if (HTTP.test(tail)) return `solana:${tail}`;
    if (!PERCENT.test(tail)) break;
    let next: string;
    try {
      next = decodeURIComponent(tail);
    } catch {
      break;
    }
    if (next === tail) break;
    tail = next;
  }
  return null;
}

/*
 * A single slot, not a queue. Two codes cannot be paid at once, and holding
 * the older one would pop a stale payment up after the newer one is settled.
 */
let pending: string | null = null;

/*
 * Listeners, because the screen may already be open when a code arrives.
 *
 * A second code handed over while the scan screen is on top was dropped: the
 * router has nowhere new to navigate to, so nothing re-rendered and nothing
 * read the slot. The screen subscribes instead of relying on a mount.
 */
const listeners = new Set<() => void>();

export function onRequestStashed(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function stashRequest(url: string): void {
  pending = url;
  for (const fn of listeners) fn();
}

/** Looks without taking — for deciding whether a payment is worth routing to. */
export function peekRequest(): string | null {
  return pending;
}

/** Reads and clears, so a remount does not re-open a payment already handled. */
export function takeRequest(): string | null {
  const held = pending;
  pending = null;
  return held;
}
