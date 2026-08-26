import { NextResponse } from "next/server";

import { collections } from "@polarispay/db";

export const dynamic = "force-dynamic";

/**
 * What the keeper has actually done, most recent first.
 *
 * Every claim this product makes -- instalments collect themselves, gas is
 * sponsored, merchants are paid without anyone pressing a button -- is a claim
 * about a background process nobody can see. A number on a landing page does
 * not settle it; a transaction hash does. So this returns the keeper's own
 * receipts, including the failures, and the page links each one to Etherscan.
 *
 * Receipts are written by the keeper at the moment it acts, so they are the
 * closest thing to a first-hand account that exists. Nothing here is derived
 * from the loan book.
 */

type ReceiptDoc = {
  actionId: string;
  kind: string;
  outcome: string;
  amount?: string;
  loanId?: string;
  installment?: number;
  merchantId?: string;
  createdAt: string;
  execution?: {
    transactionHash?: string;
    transactionLink?: string;
    sponsored?: boolean;
    gasUsedWei?: string;
  };
  error?: { kind: string; message: string };
};

const LIMIT = 8;

export async function GET(): Promise<NextResponse> {
  try {
    const { receipts } = await collections();
    const docs = (await receipts
      .find({}, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(LIMIT)
      .toArray()) as unknown as ReceiptDoc[];

    return NextResponse.json({
      actions: docs.map((d) => ({
        kind: d.kind,
        outcome: d.outcome,
        amount: d.amount,
        // A skipped liquidation check has no subject beyond the loan, so fall
        // back to the action id rather than rendering an empty row.
        subject:
          d.loanId && d.installment
            ? `Loan ${d.loanId} - instalment ${d.installment}`
            : d.loanId
              ? `Loan ${d.loanId}`
              : (d.merchantId ?? d.actionId),
        at: d.createdAt,
        txHash: d.execution?.transactionHash,
        txLink: d.execution?.transactionLink,
        sponsored: d.execution?.sponsored ?? false,
        gasUsedWei: d.execution?.gasUsedWei,
        error: d.error?.message,
      })),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[GET /api/keeper/recent] read failed", err);
    return NextResponse.json(
      {
        error:
          "Could not load keeper activity right now. This is on our side -- try again in a moment.",
      },
      { status: 500 }
    );
  }
}
