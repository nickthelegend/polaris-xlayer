import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The storefront's own checkout.
 *
 * A merchant's API key authenticates their shop to Polaris, so it belongs on
 * the merchant's server and nowhere else. The store page used to POST straight
 * to /api/checkout with the literal string "demo" as its key, which worked only
 * because that endpoint used to fall back to the demo merchant when a key did
 * not match -- a fallback that made the 401 unreachable and would have let
 * anyone open plans against any merchant. With the fallback correctly gone, the
 * button was simply dead.
 *
 * The fix is not to ship a real key to the browser, where every visitor could
 * read it out of the page source and originate loans in the merchant's name.
 * This route is the shop's backend: it holds the key server-side and is the
 * only thing that ever sees it.
 */

const CHECKOUT_URL = "/api/checkout";

export async function POST(request: Request): Promise<NextResponse> {
  const apiKey = process.env.POLARIS_STORE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "The demo store is not configured: set POLARIS_STORE_API_KEY to the demo merchant's API key.",
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  // Forwarded rather than reimplemented, so the storefront and a third-party
  // merchant integration exercise exactly the same code path -- including the
  // origination caps and the chain write.
  const res = await fetch(new URL(CHECKOUT_URL, request.url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => ({ error: "Checkout returned a malformed response" }));
  return NextResponse.json(payload, { status: res.status });
}
