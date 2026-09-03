import { NextResponse } from "next/server";

/**
 * Cross-origin access for the public read endpoints.
 *
 * Polaris is a payments network, which means the thing consuming it is somebody
 * else's storefront on somebody else's domain. Those routes answered only
 * same-origin, so a merchant integrating the checkout got `Failed to fetch`
 * with no explanation — the API was working perfectly and refusing to talk to
 * the only caller that matters.
 *
 * This is deliberately limited to reads of already-public data: the mark, the
 * risk parameters, the pool, and a balance the caller has to name an address to
 * see. It is not applied to `/api/stock/price`, which signs with the operator
 * key and is gated on a secret — that one should stay same-origin, because a
 * permissive header on an endpoint that moves the mark is how the whole book
 * gets marked down from a web page.
 */
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  // A quote is only good while the price is, so let a browser cache the
  // preflight rather than the answer.
  "Access-Control-Max-Age": "86400",
} as const;

/** Attach the headers to a response built elsewhere. */
export function withCors<T extends NextResponse>(res: T): T {
  for (const [k, v] of Object.entries(HEADERS)) res.headers.set(k, v);
  return res;
}

/** JSON, with the headers already on it. */
export function corsJson(body: unknown, init?: { status?: number }): NextResponse {
  return withCors(NextResponse.json(body, init));
}

/** The preflight. Browsers send this before any POST with a JSON content-type. */
export function corsPreflight(): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }) as NextResponse);
}
