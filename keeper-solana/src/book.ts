/**
 * What is due, read from the chain.
 *
 * The EVM build kept a MongoDB loan book because reading four hundred loans
 * off Ethereum per pass was neither cheap nor fast. Here the whole book is one
 * `getProgramAccounts` call with a discriminator filter, so the chain is the
 * book and there is no second copy to drift out of sync with it.
 *
 * The schedule math below mirrors `programs/polaris/src/math.rs` exactly. It is
 * duplicated rather than imported because the keeper must be able to decide
 * what to *attempt* without a simulation round-trip per loan — but it is only
 * ever advisory. The program recomputes every number itself and is the only
 * thing that decides what actually moves.
 */

import type { Program, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export type LoanView = {
  address: PublicKey;
  id: bigint;
  borrower: PublicKey;
  merchant: PublicKey;
  borrowerTokenAccount: PublicKey;
  principal: bigint;
  totalOwed: bigint;
  totalRepaid: bigint;
  installmentCount: number;
  installmentsPaid: number;
  startedAt: number;
  intervalSeconds: number;
  status: "active" | "repaid" | "liquidated";
};

export type SubscriptionView = {
  address: PublicKey;
  subscriber: PublicKey;
  plan: PublicKey;
  subscriberTokenAccount: PublicKey;
  nextChargeAt: number;
  periodsCharged: number;
  missedCharges: number;
  status: "active" | "cancelled" | "lapsed";
};

const statusOf = (s: any): any => Object.keys(s ?? {})[0] ?? "unknown";

export function thresholdFor(totalOwed: bigint, count: number, k: number): bigint {
  if (k === 0) return 0n;
  if (k >= count || count === 0) return totalOwed;
  const num = totalOwed * BigInt(k);
  const den = BigInt(count);
  return (num + den - 1n) / den; // ceiling, off the one canonical ladder
}

export function installmentAmount(l: LoanView): bigint {
  if (l.installmentsPaid >= l.installmentCount) return 0n;
  const target = thresholdFor(l.totalOwed, l.installmentCount, l.installmentsPaid + 1);
  return target > l.totalRepaid ? target - l.totalRepaid : 0n;
}

export function installmentDueAt(l: LoanView, index: number): number {
  return l.startedAt + (index + 1) * l.intervalSeconds;
}

export function isInstallmentDue(l: LoanView, now: number): boolean {
  return l.status === "active" && now >= installmentDueAt(l, l.installmentsPaid);
}

/**
 * The exact condition the program checks inside `liquidate`.
 *
 * Evaluating it here saves sending a transaction that would be refused, but it
 * is not what makes liquidation safe — the program's own `require!` is, and it
 * runs against the same state view as the action. On EVM this pair needed a
 * platform call to be atomic; here the check simply cannot be stale.
 */
export function isLiquidatable(l: LoanView, gracePeriod: number, now: number): boolean {
  if (l.status !== "active") return false;
  if (l.installmentsPaid >= l.installmentCount) return false;
  return now > installmentDueAt(l, l.installmentsPaid) + gracePeriod;
}

export async function loadLoans(program: Program<Idl>): Promise<LoanView[]> {
  const raw = await (program.account as any).loan.all();
  return raw.map((r: any) => ({
    address: r.publicKey,
    id: BigInt(r.account.id.toString()),
    borrower: r.account.borrower,
    merchant: r.account.merchant,
    borrowerTokenAccount: r.account.borrowerTokenAccount,
    principal: BigInt(r.account.principal.toString()),
    totalOwed: BigInt(r.account.totalOwed.toString()),
    totalRepaid: BigInt(r.account.totalRepaid.toString()),
    installmentCount: r.account.installmentCount,
    installmentsPaid: r.account.installmentsPaid,
    startedAt: Number(r.account.startedAt.toString()),
    intervalSeconds: Number(r.account.intervalSeconds.toString()),
    status: statusOf(r.account.status),
  }));
}

export async function loadSubscriptions(program: Program<Idl>): Promise<SubscriptionView[]> {
  const raw = await (program.account as any).subscription.all();
  return raw.map((r: any) => ({
    address: r.publicKey,
    subscriber: r.account.subscriber,
    plan: r.account.plan,
    subscriberTokenAccount: r.account.subscriberTokenAccount,
    nextChargeAt: Number(r.account.nextChargeAt.toString()),
    periodsCharged: r.account.periodsCharged,
    missedCharges: r.account.missedCharges,
    status: statusOf(r.account.status),
  }));
}

/** Chain time, not wall time. The program compares against this one. */
export async function chainNow(program: Program<Idl>): Promise<number> {
  const slot = await program.provider.connection.getSlot();
  const t = await program.provider.connection.getBlockTime(slot);
  return t ?? Math.floor(Date.now() / 1000);
}

export function formatUsdc(raw: bigint): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "") || "0";
  return `${neg ? "-" : ""}${whole}.${frac} USDC`;
}
