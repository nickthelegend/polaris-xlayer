import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { billHash, txHash, userAddress, paymentMode, loanId } = body;

  if (!billHash) {
    return NextResponse.json({ error: "Missing billHash" }, { status: 400 });
  }

  try {
    const db = await getDb();
    const result = await db.collection("merchant_bills").updateOne(
      { hash: billHash, status: "pending" },
      {
        $set: {
          status: "paid",
          payment_mode: paymentMode || "bnpl",
          loan_id: loanId,
          tx_hash: txHash,
          paid_at: new Date(),
          paid_by: userAddress,
        },
      }
    );

    return NextResponse.json({
      success: true,
      updated: result.modifiedCount > 0,
    });
  } catch (e: any) {
    console.error("Bill Pay Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
