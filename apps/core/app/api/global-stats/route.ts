import { NextResponse } from "next/server";

import { collections, formatUnits } from "@polarispay/db";

export const dynamic = "force-dynamic";

/**
 * Protocol-wide statistics, derived from the book.
 *
 * This previously read a `globalStats` collection that nothing ever wrote, so
 * it returned `null` - a 200 with no body, which every caller had to treat as
 * either "no data" or "broken" without being able to tell which. The numbers
 * are computed from the loans that actually exist.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const chainId = Number(process.env.CHAIN_ID ?? 11_155_111);
    const { loans, merchants } = await collections();
    const docs = await loans.find({ chainId }).toArray();

    let originated = 0n;
    let outstanding = 0n;
    let repaid = 0n;
    let instalmentsDue = 0;
    let instalmentsCollected = 0;
    const borrowers = new Set<string>();
    const now = new Date();

    for (const loan of docs) {
      originated += BigInt(loan.principalRaw);
      repaid += BigInt(loan.totalRepaidRaw);
      if (loan.status === "active") {
        outstanding += BigInt(loan.totalOwedRaw) - BigInt(loan.totalRepaidRaw);
      }
      borrowers.add(loan.borrower);
      for (const i of loan.installments) {
        if (i.dueAt <= now) {
          instalmentsDue += 1;
          if (i.state === "paid") instalmentsCollected += 1;
        }
      }
    }

    return NextResponse.json({
      chainId,
      totalOriginated: formatUnits(originated, 6),
      totalRepaid: formatUnits(repaid, 6),
      outstanding: formatUnits(outstanding, 6),
      activeLoans: docs.filter((l) => l.status === "active").length,
      repaidLoans: docs.filter((l) => l.status === "repaid").length,
      liquidatedLoans: docs.filter((l) => l.status === "liquidated").length,
      uniqueBorrowers: borrowers.size,
      activeMerchants: await merchants.countDocuments({ status: "active" }),
      collectionRate:
        instalmentsDue === 0 ? null : (instalmentsCollected / instalmentsDue) * 100,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    // The driver's message carries the cluster hostname, which does not belong
    // in a public response body.
    console.error("[GET /api/global-stats] read failed", err);
    return NextResponse.json(
      {
        error:
          "Could not load protocol statistics right now. This is on our side -- try again in a moment.",
      },
      { status: 500 }
    );
  }
}
