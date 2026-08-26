import { NextResponse } from "next/server";

import { collections, formatUnits } from "@polarispay/db";

export const dynamic = "force-dynamic";

/**
 * Everything the collections ledger renders, in one round trip.
 *
 * Amounts are computed as BigInt over the stored base-unit strings and only
 * formatted at the boundary -- a USDC balance in base units overflows a JS
 * number long before it reaches an interesting figure.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const wallet = request.headers.get("x-wallet-address");
  if (!wallet) {
    return NextResponse.json(
      { error: "Missing x-wallet-address header" },
      { status: 401 }
    );
  }

  try {
    const { merchants, loans } = await collections();

    const merchant = await merchants.findOne({
      walletAddress: wallet.toLowerCase(),
    });
    if (!merchant) {
      // A wallet with no merchant record is not an error -- it is a merchant
      // who has not onboarded yet, and the UI has a first-run state for it.
      return NextResponse.json(emptyOverview());
    }

    const docs = await loans
      .find({ merchantId: merchant.merchantId })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    let outstanding = 0n;
    let atRisk = 0n;
    let collectedThisWeek = 0n;
    let activePlans = 0;
    let dunningPlans = 0;
    let installmentsDue = 0;
    let installmentsCollected = 0;

    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const now = new Date();

    const plans = docs.map((doc) => {
      const owed = BigInt(doc.totalOwedRaw) - BigInt(doc.totalRepaidRaw);
      const next = doc.installments
        .filter((i) => i.state === "scheduled" || i.state === "dunning")
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];

      if (doc.status === "active") {
        outstanding += owed;
        activePlans += 1;
        if (next?.state === "dunning") {
          dunningPlans += 1;
          atRisk += owed;
        }
      }

      for (const inst of doc.installments) {
        if (inst.dueAt <= now) {
          installmentsDue += 1;
          if (inst.state === "paid") installmentsCollected += 1;
        }
        if (inst.state === "paid" && inst.paidAt && inst.paidAt >= weekAgo) {
          collectedThisWeek += BigInt(inst.amountRaw);
        }
      }

      const paid = doc.installments.filter((i) => i.state === "paid");
      const lastPaid = paid[paid.length - 1];

      return {
        loanId: doc.loanId,
        orderId: doc.orderId,
        borrower: doc.borrower,
        status: doc.status,
        principalDisplay: formatUnits(BigInt(doc.principalRaw), 6),
        outstandingDisplay: formatUnits(owed, 6),
        installmentsPaid: paid.length,
        installmentCount: doc.installments.length,
        nextDueAt: next ? next.dueAt.toISOString() : null,
        state: next?.state ?? "paid",
        attempts: next?.attempts ?? 0,
        lastTxHash: lastPaid?.transactionHash,
      };
    });

    return NextResponse.json({
      settledDisplay: formatUnits(BigInt(merchant.totalSettled || "0"), 6),
      outstandingDisplay: formatUnits(outstanding, 6),
      atRiskDisplay: formatUnits(atRisk, 6),
      collectedThisWeekDisplay: formatUnits(collectedThisWeek, 6),
      activePlans,
      dunningPlans,
      // Share of installments that were due and actually collected. Null when
      // nothing has come due yet: this used to report 100%, which is a claim of
      // a perfect record on a merchant who has never collected anything, and it
      // disagreed with /api/global-stats, which sends null for the same case.
      // The caller renders the absence rather than a flattering number.
      collectionRate:
        installmentsDue === 0 ? null : (installmentsCollected / installmentsDue) * 100,
      plans,
    });
  } catch (err) {
    // The driver message names our infrastructure; it belongs in the log.
    console.error("[GET /api/merchant/overview] read failed", err);
    return NextResponse.json(
      { error: "Could not load your ledger right now. This is on our side -- try again in a moment." },
      { status: 500 }
    );
  }
}

function emptyOverview() {
  return {
    settledDisplay: "0.00",
    outstandingDisplay: "0.00",
    atRiskDisplay: "0.00",
    collectedThisWeekDisplay: "0.00",
    activePlans: 0,
    dunningPlans: 0,
    // A merchant with no book has no collection rate to report. 100 here read
    // as a perfect record before a single instalment had ever been charged.
    collectionRate: null,
    plans: [],
  };
}
