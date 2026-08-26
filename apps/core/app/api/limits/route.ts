import { NextResponse } from "next/server";

import { collections, formatUnits } from "@polarispay/db";

export const dynamic = "force-dynamic";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const SCORES = process.env.POLARIS_SCORE_MANAGER;
const ENGINE = process.env.POLARIS_LOAN_ENGINE;
const VAULT = process.env.POLARIS_COLLATERAL_VAULT;
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11_155_111);

// keccak-derived and checked against the deployed ABI, not guessed.
const SEL = {
  scoreOf: "0x133af456", //       scoreOf(address)
  creditLimitOf: "0x4a9a75aa", // creditLimitOf(address)
  baseLimitOf: "0x86254486", //   baseLimitOf(address)
  activeDebtOf: "0xb8603a21", //  activeDebtOf(address)
  lockedOf: "0xa5f1e282", //      lockedOf(address)
} as const;

/**
 * A borrower's real limit, what they have drawn, and what is left.
 *
 * Every figure comes from the chain or the reconciled loan book. This route
 * previously returned a 250 base limit, 48.5 of invented spend, and a score
 * computed as `612 + verifiedProviders * 10` -- a formula over an in-memory
 * counter with no relationship to ScoreManager. A borrower saw one limit here
 * and was refused at a different one during checkout.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const address = (
    new URL(request.url).searchParams.get("address") ??
    request.headers.get("x-wallet-address") ??
    ""
  ).toLowerCase();

  if (!address) {
    return NextResponse.json(
      { error: "Pass ?address=0x… or an x-wallet-address header" },
      { status: 400 }
    );
  }
  if (!(SCORES && ENGINE)) {
    // Returning a plausible default is exactly how the fabricated numbers got
    // in. An unconfigured deployment says so.
    return NextResponse.json(
      { error: "Contract addresses are not configured on this deployment." },
      { status: 503 }
    );
  }

  try {
    const arg = address.replace("0x", "").padStart(64, "0");
    const [score, limit, base, debt, locked] = await Promise.all([
      call(SCORES, SEL.scoreOf + arg),
      call(SCORES, SEL.creditLimitOf + arg),
      call(SCORES, SEL.baseLimitOf + arg),
      call(ENGINE, SEL.activeDebtOf + arg),
      VAULT ? call(VAULT, SEL.lockedOf + arg) : Promise.resolve(0n),
    ]);

    const available = limit > debt ? limit - debt : 0n;

    const { loans } = await collections();
    const [activeLoans, repaidLoans] = await Promise.all([
      loans.countDocuments({ borrower: address, chainId: CHAIN_ID, status: "active" }),
      loans.countDocuments({ borrower: address, chainId: CHAIN_ID, status: "repaid" }),
    ]);

    return NextResponse.json({
      address,
      creditScore: Number(score),
      currentLimit: formatUnits(limit, 6),
      baseLimit: formatUnits(base, 6),
      collateralBoost: formatUnits(limit > base ? limit - base : 0n, 6),
      collateralLocked: formatUnits(locked, 6),
      used: formatUnits(debt, 6),
      available: formatUnits(available, 6),
      activeLoans,
      repaidLoans,
      chainId: CHAIN_ID,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    // A failed read is reported, never papered over with a default -- but the
    // driver's own message is not the thing to report. It names our cluster
    // host and DNS records, which tells a borrower nothing they can act on and
    // tells everyone else more than they should know. The detail goes to the
    // server log; the caller gets the fact and a next step.
    console.error("[GET /api/limits] read failed", err);
    return NextResponse.json(
      {
        error:
          "Could not read your credit right now. This is on our side -- try again in a moment.",
      },
      { status: 502 }
    );
  }
}

async function call(to: string, data: string): Promise<bigint> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result && json.result !== "0x" ? BigInt(json.result) : 0n;
}
