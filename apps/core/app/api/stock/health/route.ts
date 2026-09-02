import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { ADDRESSES, ORACLE_ABI, POOL_ABI, provider } from "@/lib/stock-chain";

export const dynamic = "force-dynamic";

/**
 * Is the thing healthy enough to demo?
 *
 * One request that answers the questions asked when something goes wrong on
 * stage: is the RPC up, is the price fresh enough to quote against, and is
 * there liquidity to pay a merchant. Each check reports on its own so a red
 * light points at the cause instead of just saying "down".
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {};
  let blockNumber: number | null = null;

  try {
    const p = provider();
    blockNumber = await p.getBlockNumber();
    const net = await p.getNetwork();
    checks.rpc = {
      ok: Number(net.chainId) === 1952,
      detail: `chain ${net.chainId} at block ${blockNumber}`,
    };
  } catch (e: any) {
    checks.rpc = { ok: false, detail: e?.shortMessage || e?.message || "unreachable" };
  }

  try {
    const oracle = new ethers.Contract(ADDRESSES.oracle, ORACLE_ABI, provider());
    const [usd, printedAt, marketOpen, fresh] = await oracle.peek(ADDRESSES.stock);
    const age = Math.max(0, Math.floor(Date.now() / 1000) - Number(printedAt));
    checks.price = {
      ok: Boolean(fresh),
      detail: fresh
        ? `$${(Number(usd) / 1e8).toFixed(2)}, ${age}s old, venue ${marketOpen ? "open" : "closed"}`
        : `stale: ${age}s old — the relayer needs to post`,
    };
  } catch (e: any) {
    checks.price = { ok: false, detail: e?.shortMessage || e?.message || "no price" };
  }

  try {
    const pool = new ethers.Contract(ADDRESSES.pool, POOL_ABI, provider());
    const available: bigint = await pool.available();
    checks.liquidity = {
      ok: available > 0n,
      detail: `${(Number(available) / 1e6).toFixed(2)} available to pay merchants`,
    };
  } catch (e: any) {
    checks.liquidity = { ok: false, detail: e?.shortMessage || e?.message || "unreadable" };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    { ok, blockNumber, engine: ADDRESSES.engine, checks },
    { status: ok ? 200 : 503 }
  );
}
