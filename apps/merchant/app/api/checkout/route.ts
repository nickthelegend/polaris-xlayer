import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { Contract, JsonRpcProvider, Wallet, parseUnits } from "ethers";

import { buildInstallments, collections, recordEvent } from "@polarispay/db";

export const dynamic = "force-dynamic";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11_155_111);
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
  if (!(LOAN_ENGINE && ORIGINATOR_KEY)) {
    return NextResponse.json(
      { error: "Checkout is not configured: set POLARIS_LOAN_ENGINE and DEPLOYER_PRIVATE_KEY." },
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
      transactionLink: `https://sepolia.etherscan.io/tx/${receipt?.hash}`,
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
