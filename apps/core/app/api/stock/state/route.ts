import { NextResponse } from "next/server";
import { ethers } from "ethers";
import {
  ADDRESSES, ENGINE_ABI, ORACLE_ABI, ERC20_ABI, POOL_ABI, RISK, STAND_INS, provider, signer,
} from "@/lib/stock-chain";

export const dynamic = "force-dynamic";

/** Everything the UI shows, read straight off X Layer. Nothing cached. */
export async function GET(req: Request) {
  try {
    // The demo has three people in it and each sees a different book. The
    // merchant holds no positions, which is also the only honest way to see
    // the empty state without inventing one.
    const asRole = new URL(req.url).searchParams.get("as") ?? "shopper";
    if (!["shopper", "merchant", "liquidator"].includes(asRole)) {
      return NextResponse.json({ error: `Unknown actor "${asRole}".` }, { status: 400 });
    }
    const p = provider();
    const engine = new ethers.Contract(ADDRESSES.engine, ENGINE_ABI, p);
    const oracle = new ethers.Contract(ADDRESSES.oracle, ORACLE_ABI, p);
    const stock = new ethers.Contract(ADDRESSES.stock, ERC20_ABI, p);
    const stable = new ethers.Contract(ADDRESSES.stable, ERC20_ABI, p);
    const pool = new ethers.Contract(ADDRESSES.pool, POOL_ABI, p);

    const viewer = signer(asRole as any).address;
    const shopper = signer("shopper").address;
    const merchant = signer("merchant").address;

    const [price, source, sSym, stSym, poolAvail, poolOut, poolEarned, blockNumber] = await Promise.all([
      oracle.peek(ADDRESSES.stock),
      oracle.sourceOf(ADDRESSES.stock),
      stock.symbol(),
      stable.symbol(),
      pool.available(),
      pool.outstanding(),
      pool.earned(),
      p.getBlockNumber(),
    ]);

    const ids: bigint[] = await engine.loansOf(viewer);
    const loans = await Promise.all(
      ids.map(async (id) => {
        const l = await engine.getLoan(id);
        const [owed, hf, liq] = await Promise.all([
          engine.amountOwed(id), engine.healthFactor(id), engine.isLiquidatable(id),
        ]);
        return {
          id: Number(id),
          shares: l.shares.toString(),
          principal: l.principal.toString(),
          fee: l.fee.toString(),
          owed: owed.toString(),
          dueAt: Number(l.dueAt),
          openPrice: l.openPrice.toString(),
          openedWhileClosed: l.openedWhileClosed,
          status: Number(l.status),
          merchant: l.merchant,
          healthFactor: hf === ethers.MaxUint256 ? null : (Number(hf) / 1e18).toFixed(2),
          liquidatable: liq,
        };
      })
    );

    return NextResponse.json({
      blockNumber,
      addresses: ADDRESSES,
      risk: RISK,
      standIns: STAND_INS,
      price: {
        usdPerShare: price[0].toString(),
        printedAt: Number(price[1]),
        marketOpen: price[2],
        fresh: price[3],
        source,
        ageSeconds: Math.max(0, Math.floor(Date.now() / 1000) - Number(price[1])),
      },
      tokens: { stockSymbol: sSym, stableSymbol: stSym },
      pool: { available: poolAvail.toString(), outstanding: poolOut.toString(), earned: poolEarned.toString() },
      viewer: { role: asRole, address: viewer },
      actors: { shopper, merchant, liquidator: signer("liquidator").address },
      balances: {
        shopperShares: (await stock.balanceOf(shopper)).toString(),
        shopperStable: (await stable.balanceOf(shopper)).toString(),
        viewerShares: (await stock.balanceOf(viewer)).toString(),
        merchantStable: (await stable.balanceOf(merchant)).toString(),
        engineShares: (await stock.balanceOf(ADDRESSES.engine)).toString(),
      },
      loans,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.shortMessage || e?.message || "read failed" }, { status: 500 });
  }
}
