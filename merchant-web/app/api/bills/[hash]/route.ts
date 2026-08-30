import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;

  if (!hash) {
    return NextResponse.json({ error: "Missing hash" }, { status: 400 });
  }

  try {
    const db = await getDb();
    const bill = await db.collection("merchant_bills").findOne({ hash });

    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    // Get the merchant app info
    const app = bill.app_id
      ? await db.collection("merchant_apps").findOne({ _id: bill.app_id })
      : null;

    return NextResponse.json({
      _id: bill._id,
      amount: bill.amount,
      asset: bill.asset || "USDC",
      description: bill.description,
      hash: bill.hash,
      status: bill.status,
      created_at: bill.created_at,
      merchant: app ? {
        name: app.name,
        category: app.category || "General",
        escrow_contract: app.escrow_contract || null,
        user: { wallet_address: app.wallet_address || "" },
      } : null,
    });
  } catch (e: any) {
    console.error("Bill Lookup Error:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
