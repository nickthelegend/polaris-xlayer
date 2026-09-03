import { NextResponse } from "next/server";

import { corsJson, corsPreflight } from "@/lib/cors";
import { throttled } from "@/lib/throttle";
import { ethers } from "ethers";
import { ADDRESSES, ENGINE_ABI, POOL_ABI, explain, provider } from "@/lib/stock-chain";

export const dynamic = "force-dynamic";


/**
 * Quote before anything is locked, so the number on the checkout is the number
 * the contract will enforce.
 */
export async function POST(req: Request) {
  try {
    if (throttled(req)) {
      return corsJson({ error: "Too many quotes. Wait a moment." }, { status: 429 });
    }
    /*
     * Parse before trusting.
     *
     * A malformed body threw inside req.json() and left the raw parser message
     * in a 500, and `1e30` shares reached parseUnits and came back as
     * "invalid FixedNumber string value" — both of them internals leaking to
     * whoever poked the endpoint.
     */
    let body: any;
    try {
      body = await req.json();
    } catch {
      return corsJson({ error: "That request body is not valid JSON." }, { status: 400 });
    }
    const { shares, tenorDays } = body ?? {};
    const n = Number(shares);
    if (!Number.isFinite(n) || n <= 0) {
      return corsJson({ error: "Enter a number of shares greater than zero." }, { status: 400 });
    }
    // 1e9 shares of anything is not a checkout, and the number is past what
    // parseUnits will accept as a decimal string.
    if (n > 1e9) {
      return corsJson({ error: "That is more shares than this market has." }, { status: 400 });
    }
    if (!/^\d*\.?\d*$/.test(String(shares).trim())) {
      return corsJson({ error: "Enter the share count as a plain decimal number." }, { status: 400 });
    }
    const days = Number(tenorDays ?? 7);
    if (!Number.isInteger(days) || days < 7 || days > 14) {
      return corsJson({ error: "The tenor must be a whole number of days between 7 and 14." }, { status: 400 });
    }
    const engine = new ethers.Contract(ADDRESSES.engine, ENGINE_ABI, provider());
    const wei = ethers.parseUnits(String(shares), 18);
    const q = await engine.quote(ADDRESSES.stock, wei, days * 86400);

    /*
     * A quote the pool cannot honour is worse than no quote.
     *
     * The engine reverts with InsufficientLiquidity at openLoan, which is
     * correct but late: the shopper has already read a number, decided, and
     * pressed a button. Checking here means the ceiling shown is the smaller
     * of what the collateral supports and what there is actually money to pay.
     */
    const pool = new ethers.Contract(ADDRESSES.pool, POOL_ABI, provider());
    const available: bigint = await pool.available();
    if (available === 0n) {
      return corsJson(
        { error: "The pool has no stablecoin to pay a merchant with right now." },
        { status: 409 }
      );
    }
    const cappedByPool = q.maxBorrow > available;
    const maxBorrow = cappedByPool ? available : q.maxBorrow;
    const feeOnMax = cappedByPool ? await engine.feeFor(maxBorrow, days * 86400) : q.feeOnMax;

    return corsJson({
      shares: wei.toString(),
      collateralValue: q.collateralValue.toString(),
      maxBorrow: maxBorrow.toString(),
      ltvBps: Number(q.ltvBps),
      feeOnMax: feeOnMax.toString(),
      poolAvailable: available.toString(),
      cappedByPool,
      usdPerShare: q.usdPerShare.toString(),
      marketOpen: q.marketOpen,
      tenorDays: days,
    });
  } catch (e: any) {
    const { message, status } = explain(e, "request failed");
    return corsJson({ error: message }, { status });
  }
}

/**
 * A browser sends this before any cross-origin POST carrying JSON, and before
 * a GET with a custom header. Without it the real request is never made.
 */
export async function OPTIONS() {
  return corsPreflight();
}
