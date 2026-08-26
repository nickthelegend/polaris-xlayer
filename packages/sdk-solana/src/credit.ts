import { PublicKey } from "@solana/web3.js";
import { createHash, randomBytes } from "node:crypto";

/**
 * A merchant order id as the program sees it: exactly 32 bytes.
 *
 * Short ids go in directly, right-aligned and zero-padded, so the payment
 * address is derivable from the order id by anyone holding it. Anything longer
 * is hashed — never truncated, which would make two long ids sharing a prefix
 * the same order and get the second payment refused as a duplicate.
 */
export function orderRef(orderId: string): Buffer {
  const bytes = Buffer.from(orderId, "utf8");
  if (bytes.length <= 32) {
    const out = Buffer.alloc(32);
    bytes.copy(out, 32 - bytes.length);
    return out;
  }
  return createHash("sha256").update(bytes).digest();
}

/**
 * A reference for a plan that is not against a merchant basket.
 *
 * Random rather than derived: two callers without an order id must not collide
 * into each other's guard account and refuse each other's perfectly valid
 * loans.
 */
export function randomOrderRef(): Buffer {
  return randomBytes(32);
}

export function derivePdas(programId: PublicKey) {
  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, programId)[0];
  const u64 = (n: number | bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  return {
    protocol: pda([Buffer.from("protocol")]),
    liquidityVault: pda([Buffer.from("liquidity")]),
    collateralVault: pda([Buffer.from("collateral_vault")]),
    profileOf: (user: PublicKey) => pda([Buffer.from("profile"), user.toBuffer()]),
    loanOf: (id: number | bigint) => pda([Buffer.from("loan"), u64(id)]),
    merchantOf: (authority: PublicKey) => pda([Buffer.from("merchant"), authority.toBuffer()]),
    planOf: (id: number | bigint) => pda([Buffer.from("plan"), u64(id)]),
    subOf: (subscriber: PublicKey, plan: PublicKey) =>
      pda([Buffer.from("sub"), subscriber.toBuffer(), plan.toBuffer()]),
    paymentOf: (merchant: PublicKey, order: string | Uint8Array) =>
      pda([
        Buffer.from("payment"),
        merchant.toBuffer(),
        typeof order === "string" ? orderRef(order) : order,
      ]),
  };
}

export type CreditLine = {
  score: number;
  /** Score-derived limit, before collateral. */
  baseLimit: bigint;
  /** What locked collateral adds. */
  collateralBoost: bigint;
  /** What the borrower can actually draw against. */
  limit: bigint;
  /** Everything currently owed across every open plan. */
  activeDebt: bigint;
  available: bigint;
  lockedCollateral: bigint;
};

/**
 * The same piecewise ladder the program uses.
 *
 * Duplicated here on purpose: a checkout has to decide whether to *show* the
 * pay-later option before it sends anything, and a round trip per render is not
 * acceptable. The program recomputes it and is the only thing that decides.
 * Piecewise rather than linear so the jumps are legible to a user — "get to 700
 * and your limit doubles" — instead of a curve nobody can reason about.
 */
export function baseLimitForScore(score: number): bigint {
  if (score >= 800) return 5_000_000_000n;
  if (score >= 740) return 2_500_000_000n;
  if (score >= 670) return 1_000_000_000n;
  if (score >= 580) return 500_000_000n;
  return 200_000_000n;
}

export function creditLimitFor(
  profile: {
    score: number;
    activeDebt: bigint;
    lockedCollateral: bigint;
  },
  creditMultiplierBps: number,
): CreditLine {
  const baseLimit = baseLimitForScore(profile.score);
  const collateralBoost =
    (profile.lockedCollateral * BigInt(creditMultiplierBps)) / 10_000n;
  const limit = baseLimit + collateralBoost;
  return {
    score: profile.score,
    baseLimit,
    collateralBoost,
    limit,
    activeDebt: profile.activeDebt,
    available: limit > profile.activeDebt ? limit - profile.activeDebt : 0n,
    lockedCollateral: profile.lockedCollateral,
  };
}

export type Quote = {
  principal: bigint;
  interest: bigint;
  totalOwed: bigint;
  installmentCount: number;
  intervalSeconds: number;
  /** Cumulative thresholds, and the amount each installment actually costs. */
  schedule: { index: number; dueAt: number; amount: bigint; cumulative: bigint }[];
};

/**
 * What a plan will cost, before the borrower commits to it.
 *
 * Mirrors `math.rs`: interest is annualised and pro-rated over the term, and
 * every threshold is ceiled off one canonical ladder. Rounding the schedule any
 * other way is how a full payment lands a base unit short of its own threshold
 * and counts as unpaid.
 */
export function quoteInstallments(params: {
  principal: bigint;
  installmentCount: number;
  intervalSeconds: number;
  startedAt?: number;
  interestRateBps?: number;
}): Quote {
  const { principal, installmentCount, intervalSeconds } = params;
  const rate = BigInt(params.interestRateBps ?? 1_000);
  const startedAt = params.startedAt ?? Math.floor(Date.now() / 1000);

  const term = BigInt(installmentCount) * BigInt(intervalSeconds);
  const interest = (principal * rate * term) / (10_000n * 365n * 86_400n);
  const totalOwed = principal + interest;

  const threshold = (k: number): bigint => {
    if (k === 0) return 0n;
    if (k >= installmentCount) return totalOwed;
    const num = totalOwed * BigInt(k);
    const den = BigInt(installmentCount);
    return (num + den - 1n) / den;
  };

  const schedule = Array.from({ length: installmentCount }, (_, i) => ({
    index: i,
    dueAt: startedAt + (i + 1) * intervalSeconds,
    amount: threshold(i + 1) - threshold(i),
    cumulative: threshold(i + 1),
  }));

  return { principal, interest, totalOwed, installmentCount, intervalSeconds, schedule };
}
