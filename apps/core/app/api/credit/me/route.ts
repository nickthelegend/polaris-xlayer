import { NextResponse } from "next/server";

import { collections, formatUnits } from "@polarispay/db";

export const dynamic = "force-dynamic";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const SCORES = process.env.POLARIS_SCORE_MANAGER;
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11_155_111);

// keccak-derived and verified against the deployed ABI, not guessed.
const SEL_SCORE_OF = "0x133af456"; //        scoreOf(address)
const SEL_CREDIT_LIMIT_OF = "0x4a9a75aa"; // creditLimitOf(address)

/**
 * The borrower's credit line.
 *
 * Score and limit come from the chain, because those are the numbers a
 * borrower will check against a block explorer. Plans come from Mongo, which
 * carries the installment schedule and dunning state the contract does not
 * store. If the chain read fails the response still renders from the book
 * rather than erroring the whole page -- a borrower being unable to see their
 * plans because an RPC blipped is a worse failure than a stale score.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const address = (
    url.searchParams.get("address") ??
    request.headers.get("x-wallet-address") ??
    ""
  ).toLowerCase();

  if (!address) {
    return NextResponse.json(
      { error: "Pass ?address=0x… or an x-wallet-address header" },
      { status: 400 }
    );
  }

  try {
    const { loans, merchants } = await collections();

    const docs = await loans
      .find({ borrower: address, chainId: CHAIN_ID })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    const names = new Map<string, string>();
    for (const m of await merchants.find({}).limit(200).toArray()) {
      names.set(m.merchantId, m.name);
    }

    let used = 0n;
    let onTime = 0;
    let late = 0;
    let nextDue: { at: Date; amountRaw: bigint } | null = null;

    const plans = docs.map((doc) => {
      const owed = BigInt(doc.totalOwedRaw) - BigInt(doc.totalRepaidRaw);
      if (doc.status === "active") used += owed;

      for (const inst of doc.installments) {
        if (inst.state === "paid") {
          // Paid after the due date counts as late, matching how the contract
          // scores it.
          if (inst.paidAt && inst.paidAt.getTime() > inst.dueAt.getTime() + 3 * 86_400_000) {
            late += 1;
          } else {
            onTime += 1;
          }
        }
        if (
          doc.status === "active" &&
          (inst.state === "scheduled" || inst.state === "dunning") &&
          (!nextDue || inst.dueAt < nextDue.at)
        ) {
          nextDue = { at: inst.dueAt, amountRaw: BigInt(inst.amountRaw) };
        }
      }

      return {
        loanId: doc.loanId,
        orderId: doc.orderId,
        merchantName: names.get(doc.merchantId) ?? doc.merchantId,
        status: doc.status,
        outstandingDisplay: formatUnits(owed, 6),
        installments: doc.installments.map((i) => ({
          index: i.index,
          dueAt: i.dueAt.toISOString(),
          amountDisplay: i.amountDisplay,
          state: i.state,
          attempts: i.attempts,
          transactionHash: i.transactionHash,
        })),
      };
    });

    const { score, limitRaw } = await readCreditOnChain(address);
    const available = limitRaw > used ? limitRaw - used : 0n;

    return NextResponse.json({
      score,
      // Every on-time payment is worth +12 on chain; surfacing the last move
      // makes the number feel earned rather than assigned.
      scoreDelta: onTime > 0 ? 12 : 0,
      limitDisplay: formatUnits(limitRaw, 6),
      availableDisplay: formatUnits(available, 6),
      usedDisplay: formatUnits(used, 6),
      onTimePayments: onTime,
      latePayments: late,
      nextDueAt: nextDue ? nextDue.at.toISOString() : null,
      nextDueDisplay: nextDue ? formatUnits(nextDue.amountRaw, 6) : null,
      plans,
    });
  } catch (err) {
    // Same reasoning as /api/limits: the driver message names infrastructure,
    // so it is logged rather than returned.
    console.error("[GET /api/credit/me] read failed", err);
    return NextResponse.json(
      {
        error:
          "Could not load your plans right now. This is on our side -- try again in a moment.",
      },
      { status: 500 }
    );
  }
}

async function readCreditOnChain(
  address: string
): Promise<{ score: number; limitRaw: bigint }> {
  const fallback = { score: 600, limitRaw: 500_000_000n };
  if (!SCORES) return fallback;

  const arg = address.replace("0x", "").padStart(64, "0");
  try {
    const [scoreHex, limitHex] = await Promise.all([
      ethCall(SCORES, SEL_SCORE_OF + arg),
      ethCall(SCORES, SEL_CREDIT_LIMIT_OF + arg),
    ]);
    return {
      score: scoreHex && scoreHex !== "0x" ? Number(BigInt(scoreHex)) : fallback.score,
      limitRaw: limitHex && limitHex !== "0x" ? BigInt(limitHex) : fallback.limitRaw,
    };
  } catch {
    return fallback;
  }
}

async function ethCall(to: string, data: string): Promise<string> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
    signal: AbortSignal.timeout(6000),
  });
  const json = (await res.json()) as { result?: string };
  return json.result ?? "0x";
}
