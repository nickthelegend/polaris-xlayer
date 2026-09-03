import { NextResponse } from "next/server";

import { healthReport } from "@polarispay/db";

export const dynamic = "force-dynamic";

/**
 * Keeper health, for the merchant ledger.
 *
 * A merchant's real question is not "is the API up" - it is "is anything
 * collecting my money right now". This answers that from the book rather than
 * from anything the keeper says about itself, so a stopped keeper shows as
 * stopped instead of showing nothing at all.
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Default to X Layer, not Sepolia. These read `CHAIN_ID` and fell back to
    // 11_155_111 — a chain these contracts were never deployed to — so a missing
    // env var did not fail, it quietly answered about the wrong network. The
    // underscores kept it out of every grep for "11155111" too.
    const report = await healthReport(Number(process.env.CHAIN_ID ?? 1952));
    return NextResponse.json(report);
  } catch (err) {
    // The driver message names our infrastructure; it belongs in the log.
    console.error("[GET /api/keeper/health] read failed", err);
    return NextResponse.json(
      { error: "Could not read keeper health right now." },
      { status: 500 }
    );
  }
}
