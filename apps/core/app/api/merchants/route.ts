import { NextResponse } from "next/server";

import { collections } from "@polarispay/db";

export const dynamic = "force-dynamic";

/**
 * Public merchant directory.
 *
 * This previously returned raw merchant documents, which included
 * `apiKeyHash` and `webhookSecret` - credentials, on an unauthenticated GET.
 * Only fields a shopper needs to see are projected now, and the projection is
 * an allowlist rather than a blocklist so a new sensitive field cannot leak by
 * being forgotten.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { merchants } = await collections();
    const rows = await merchants
      .find(
        { status: "active" },
        {
          projection: {
            _id: 0,
            merchantId: 1,
            name: 1,
            payoutAddress: 1,
            chainId: 1,
            createdAt: 1,
          },
        }
      )
      .limit(200)
      .toArray();

    return NextResponse.json(rows);
  } catch (err) {
    // Returning [] made a database failure indistinguishable from "no rows", so
    // the status still has to be a 500. The message does not: the driver's text
    // names the cluster host, and this is an unauthenticated public endpoint.
    console.error("[GET /api/merchants] read failed", err);
    return NextResponse.json(
      {
        error:
          "Could not load the merchant directory right now. This is on our side -- try again in a moment.",
      },
      { status: 500 }
    );
  }
}
