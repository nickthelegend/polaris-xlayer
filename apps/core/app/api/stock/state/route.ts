import { NextResponse } from "next/server";

import { corsJson, corsPreflight } from "@/lib/cors";
import { ethers } from "ethers";
import {
  ADDRESSES, ENGINE_ABI, ORACLE_ABI, ERC20_ABI, POOL_ABI, RISK, STAND_INS, provider,
} from "@/lib/stock-chain";

export const dynamic = "force-dynamic";

/** Everything the UI shows, read straight off X Layer. Nothing cached. */
export async function GET(req: Request) {
  try {
    /*
     * Whose book is this?
     *
     * The connected wallet's, given as ?address=. This used to resolve the
     * viewer from a server-held key, which meant the page said "you hold"
     * about an address the visitor had never seen and could not sign for.
     *
     * There is no operator impersonation any more: the actor keys are gone
     * from the deployment, so there is nothing to impersonate with.
     */
    const url = new URL(req.url);
    const address = url.searchParams.get("address");
    if (address && !ethers.isAddress(address)) {
      return corsJson({ error: `"${address}" is not an address.` }, { status: 400 });
    }
    const p = provider();
    const engine = new ethers.Contract(ADDRESSES.engine, ENGINE_ABI, p);
    const oracle = new ethers.Contract(ADDRESSES.oracle, ORACLE_ABI, p);
    const stock = new ethers.Contract(ADDRESSES.stock, ERC20_ABI, p);
    const stable = new ethers.Contract(ADDRESSES.stable, ERC20_ABI, p);
    const pool = new ethers.Contract(ADDRESSES.pool, POOL_ABI, p);

    // A connected address wins. Falling back to an operator key keeps the
    // merchant/liquidator demo views working; with neither, there is no book
    // to show and the UI says so rather than showing someone else's.
    /*
     * The merchant is an address, not a key.
     *
     * Reading it from a private key meant this route needed one just to
     * render a heading. Nothing here signs any more, so the only server key
     * left in the app is the oracle relayer's, behind its own secret.
     */
    const merchant = process.env.POLARIS_MERCHANT_ADDRESS ?? null;
    const viewer = address;

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

    const ids: bigint[] = viewer ? await engine.loansOf(viewer) : [];
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

    return corsJson({
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
      viewer: { role: address ? "connected" : null, address: viewer },
      merchant,
      balances: {
        viewerShares: viewer ? (await stock.balanceOf(viewer)).toString() : "0",
        viewerStable: viewer ? (await stable.balanceOf(viewer)).toString() : "0",
        merchantStable: (await stable.balanceOf(merchant)).toString(),
        engineShares: (await stock.balanceOf(ADDRESSES.engine)).toString(),
      },
      loans,
    });
  } catch (e: any) {
    return corsJson({ error: e?.shortMessage || e?.message || "read failed" }, { status: 500 });
  }
}

/**
 * A browser sends this before any cross-origin POST carrying JSON, and before
 * a GET with a custom header. Without it the real request is never made.
 */
export async function OPTIONS() {
  return corsPreflight();
}
