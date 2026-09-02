import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { ADDRESSES, ORACLE_ABI, EXPLORER, settle, signer , explain } from "@/lib/stock-chain";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Post a print.
 *
 * `relay` fetches the live venue price — the same thing the standalone relayer
 * does. `move` applies a percentage to the last print so the liquidation path
 * can be shown on demand, and labels itself as a demo move on chain so nobody
 * mistakes it for a real quote later.
 */
/**
 * The relayer's key, shared with whoever operates it.
 *
 * This route is the one remaining place a server key signs, and it must stay
 * that way: the price relayer is an operator role, not a user action. But it
 * was open to the internet, and this endpoint moves the mark that every open
 * position is valued against — anyone could have marked the whole book down
 * and liquidated it. It now needs the secret.
 */
function authorised(req: Request): boolean {
  const expected = process.env.RELAYER_KEY;
  if (!expected) return false; // no key configured means no operator access
  const given = req.headers.get("x-relayer-key");
  return typeof given === "string" && given.length > 0 && given === expected;
}

export async function POST(req: Request) {
  try {
    if (!authorised(req)) {
      return NextResponse.json(
        { error: "The price relayer is an operator endpoint and needs its key." },
        { status: 401 }
      );
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "That request body is not valid JSON." }, { status: 400 });
    }
    const { mode, pct } = body ?? {};
    const oracle = new ethers.Contract(ADDRESSES.oracle, ORACLE_ABI, signer("deployer"));

    let price: bigint, printedAt: number, marketOpen: boolean, source: string;

    if (mode === "move") {
      const factor = Number(pct);
      if (!Number.isFinite(factor) || factor <= -100 || factor > 500) {
        return NextResponse.json({ error: "Move must be a percentage above -100." }, { status: 400 });
      }
      const cur = await oracle.peek(ADDRESSES.stock);
      if (cur[0] === 0n) return NextResponse.json({ error: "There is no price to move yet." }, { status: 409 });
      price = (BigInt(cur[0]) * BigInt(Math.round((100 + factor) * 100))) / 10000n;
      if (price === 0n) return NextResponse.json({ error: "That move takes the price to zero." }, { status: 400 });
      printedAt = Math.floor(Date.now() / 1000);
      marketOpen = true;
      source = `${await oracle.sourceOf(ADDRESSES.stock)} (demo move ${factor > 0 ? "+" : ""}${factor}%)`;
    } else {
      const symbol = process.env.STOCK_SYMBOL || "AAPL";
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`,
        { headers: { "User-Agent": "Mozilla/5.0 polaris" }, cache: "no-store" }
      );
      if (!res.ok) return NextResponse.json({ error: `The venue did not answer (HTTP ${res.status}).` }, { status: 502 });
      const m = (await res.json())?.chart?.result?.[0]?.meta;
      if (!m?.regularMarketPrice) return NextResponse.json({ error: "The venue returned no price." }, { status: 502 });
      const now = Math.floor(Date.now() / 1000);
      const reg = m.currentTradingPeriod?.regular;
      price = BigInt(Math.round(m.regularMarketPrice * 1e8));
      printedAt = Number(m.regularMarketTime);
      marketOpen = !!reg && now >= reg.start && now < reg.end;
      source = `${m.fullExchangeName || m.exchangeName} ${marketOpen ? "last" : "close"}`;
    }

    const tx = await oracle.postPrice(ADDRESSES.stock, price, printedAt, marketOpen, source);
    const receipt = await tx.wait();
    await settle(receipt);
    return NextResponse.json({
      usdPerShare: price.toString(), printedAt, marketOpen, source,
      hash: tx.hash, explorer: `${EXPLORER}/tx/${tx.hash}`,
    });
  } catch (e: any) {
    const { message, status } = explain(e, "request failed");
    return NextResponse.json({ error: message }, { status });
  }
}
