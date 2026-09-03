import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { Contract, JsonRpcProvider, Wallet, parseUnits } from "ethers";

import { buildInstallments, collections, recordEvent } from "@polarispay/db";

export const dynamic = "force-dynamic";

// POLARIS_RPC_URL, not SEPOLIA_RPC_URL: the contracts are on X Layer, and a
// fallback pointing at a chain they were never deployed to answers every read
// with zeros instead of failing loudly. SEPOLIA_RPC_URL is still read so an
// older deployment keeps working.
const RPC =
  process.env.POLARIS_RPC_URL ?? process.env.SEPOLIA_RPC_URL ?? "https://testrpc.xlayer.tech";
// Default to X Layer, not Sepolia. These read `CHAIN_ID` and fell back to
// 11_155_111 — a chain these contracts were never deployed to — so a missing
// env var did not fail, it quietly answered about the wrong network. The
// underscores kept it out of every grep for "11155111" too.
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 1952);
const LOAN_ENGINE = process.env.POLARIS_LOAN_ENGINE;
const ORIGINATOR_KEY = process.env.DEPLOYER_PRIVATE_KEY;

const ENGINE_ABI = [
  "function createLoan(address borrower,address merchant,uint256 principal,uint32 installmentCount,uint64 intervalSeconds) returns (uint256)",
  "function loanCount() view returns (uint256)",
  "function getLoan(uint256) view returns (tuple(address borrower,address merchant,uint128 principal,uint128 totalOwed,uint128 totalRepaid,uint32 installmentCount,uint32 installmentsPaid,uint64 startedAt,uint64 intervalSeconds,uint8 status))",
];

/**
 * Open a BNPL plan.
 *
 * `createLoan` is originator-gated, so this endpoint holds the signer rather
 * than the buyer. That is deliberate: the buyer's only on-chain action at
 * checkout is the ERC-20 approval every later instalment is drawn against, and
 * they never pay gas to start a plan.
 *
 * The write happens on chain first and is mirrored into Mongo second. If the
 * mirror fails the plan still exists and `pnpm db:sync` reconciles it, whereas
 * writing the book first would leave a phantom plan the chain has never heard
 * of.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // Name only what is actually missing. Listing both sends whoever is
  // deploying this to re-check a variable that was already set.
  const missing = [
    LOAN_ENGINE ? null : "POLARIS_LOAN_ENGINE",
    ORIGINATOR_KEY ? null : "DEPLOYER_PRIVATE_KEY",
  ].filter((v): v is string => v !== null);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Checkout is not configured: set ${missing.join(" and ")}.` },
      { status: 503 }
    );
  }

  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) {
    return NextResponse.json({ error: "Missing x-api-key" }, { status: 401 });
  }

  let body: {
    borrower?: string;
    amount?: string;
    orderId?: string;
    installments?: number;
    intervalSeconds?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { borrower, amount, orderId } = body;
  const installments = body.installments ?? 4;
  const intervalSeconds = body.intervalSeconds ?? 14 * 86_400;

  if (!(borrower && amount && orderId)) {
    return NextResponse.json(
      { error: "borrower, amount and orderId are required" },
      { status: 400 }
    );
  }
  if (installments < 1 || installments > 24) {
    return NextResponse.json({ error: "installments must be between 1 and 24" }, { status: 400 });
  }

  try {
    const { merchants, loans } = await collections();
    const merchant = await merchants.findOne({
      apiKeyHash: createHash("sha256").update(apiKey).digest("hex"),
    });
    // No fallback. This previously dropped to the seeded demo merchant when the
    // key did not match, which made the 401 below unreachable and let any
    // caller originate a real on-chain loan -- paying out protocol liquidity --
    // with an invalid API key. Convenience is not worth an open mint.
    if (!merchant) {
      return NextResponse.json({ error: "Unknown or invalid API key" }, { status: 401 });
    }
    const resolved = merchant;
    if (resolved.status !== "active") {
      return NextResponse.json({ error: "Merchant is not active" }, { status: 403 });
    }

    const existing = await loans.findOne({ orderId, chainId: CHAIN_ID });
    if (existing) {
      // Checkout retries are common. Return the original plan rather than
      // opening a second one against the same order.
      return NextResponse.json({ loanId: existing.loanId, orderId, replayed: true });
    }

    const provider = new JsonRpcProvider(RPC);
    const signer = new Wallet(ORIGINATOR_KEY, provider);
    const engine = new Contract(LOAN_ENGINE, ENGINE_ABI, signer);

    const principal = parseUnits(amount, 6);
    const tx = await engine.createLoan(
      borrower,
      resolved.payoutAddress,
      principal,
      installments,
      intervalSeconds
    );
    const receipt = await tx.wait();

    const loanId: bigint = await engine.loanCount();
    const onChain = await engine.getLoan(loanId);

    // Upsert, not insert. The chain has already assigned this id, so a stale
    // row under the same id must be overwritten by chain truth rather than
    // colliding -- the write succeeded on chain and the response has to
    // reflect that.
    await loans.updateOne(
      { loanId: loanId.toString(), chainId: CHAIN_ID },
      {
        $set: {
          loanId: loanId.toString(),
          chainId: CHAIN_ID,
          borrower: borrower.toLowerCase(),
          merchantId: resolved.merchantId,
          orderId,
          principalRaw: principal.toString(),
          totalOwedRaw: onChain.totalOwed.toString(),
          totalRepaidRaw: "0",
          status: "active",
          installments: buildInstallments({
            totalOwedRaw: BigInt(onChain.totalOwed),
            count: installments,
            intervalSeconds,
            startAt: new Date(Number(onChain.startedAt) * 1000),
            symbol: "pUSDC",
          }),
          liquidationCandidate: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    await recordEvent({
      type: "plan_opened",
      loanId: loanId.toString(),
      merchantId: resolved.merchantId,
      borrower: borrower.toLowerCase(),
      chainId: CHAIN_ID,
      transactionHash: receipt?.hash,
      payload: { orderId, amount, installments, intervalSeconds },
    });

    return NextResponse.json({
      loanId: loanId.toString(),
      orderId,
      transactionHash: receipt?.hash,
      transactionLink: `https://www.oklink.com/x-layer-testnet/tx/${receipt?.hash}`,
      installments,
      totalOwedRaw: onChain.totalOwed.toString(),
    });
  } catch (err) {
    const message = (err as Error).message ?? "Checkout failed";
    // Surface the protocol's own reason -- "over your credit limit" is
    // actionable for a buyer in a way that a raw revert string is not.
    if (/ExceedsCreditLimit/.test(message)) {
      return NextResponse.json(
        { error: "This order is above the buyer's credit limit." },
        { status: 422 }
      );
    }
    if (/NotOriginator/.test(message)) {
      return NextResponse.json(
        { error: "This signer is not a registered originator on the LoanEngine." },
        { status: 403 }
      );
    }
    // Anything past the mapped reverts is an ethers or RPC internal -- "missing
    // revert data", a coalesced provider failure, a driver message naming our
    // infrastructure. Returning it handed the shopper a string they cannot act
    // on and told an attacker about our stack, so it goes to the log instead.
    console.error("[POST /api/checkout] origination failed", err);
    return NextResponse.json(
      { error: "Could not open the payment plan right now. Try again in a moment." },
      { status: 500 }
    );
  }
}
