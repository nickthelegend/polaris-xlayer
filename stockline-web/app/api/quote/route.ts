import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { ADDRESSES, ENGINE_ABI, provider , explain } from "@/lib/chain";

export const dynamic = "force-dynamic";

/**
 * Quote before anything is locked, so the number on the checkout is the number
 * the contract will enforce.
 */
export async function POST(req: Request) {
  try {
    const { shares, tenorDays } = await req.json();
    const n = Number(shares);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "Enter a number of shares greater than zero." }, { status: 400 });
    }
    const days = Number(tenorDays ?? 7);
    if (!Number.isInteger(days) || days < 7 || days > 14) {
      return NextResponse.json({ error: "The tenor must be a whole number of days between 7 and 14." }, { status: 400 });
    }
    const engine = new ethers.Contract(ADDRESSES.engine, ENGINE_ABI, provider());
    const wei = ethers.parseUnits(String(shares), 18);
    const q = await engine.quote(ADDRESSES.stock, wei, days * 86400);
    return NextResponse.json({
      shares: wei.toString(),
      collateralValue: q.collateralValue.toString(),
      maxBorrow: q.maxBorrow.toString(),
      ltvBps: Number(q.ltvBps),
      feeOnMax: q.feeOnMax.toString(),
      usdPerShare: q.usdPerShare.toString(),
      marketOpen: q.marketOpen,
      tenorDays: days,
    });
  } catch (e: any) {
    const { message, status } = explain(e, "request failed");
    return NextResponse.json({ error: message }, { status });
  }
}
