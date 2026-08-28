import { PublicKey } from "@solana/web3.js";

import type { Chain } from "./chain.ts";

/**
 * A merchant's book, read straight off the chain.
 *
 * There is no merchant database and no merchant login. Everything a merchant
 * needs to see about their own trade is already public state under their PDA:
 * the plans financed against them, what has been collected, what is still
 * outstanding. Reading it needs no key at all, which is why this dashboard can
 * be served to anyone holding the address without a single credential.
 */
export type MerchantLoan = {
  id: number;
  borrower: string;
  status: string;
  principal: bigint;
  owed: bigint;
  repaid: bigint;
  installmentsPaid: number;
  installmentCount: number;
  startedAt: number;
  intervalSeconds: number;
};

export type MerchantBook = {
  address: string;
  name: string;
  payout: string;
  authority: string;
  active: boolean;
  maxOrderValue: bigint;
  /** What the program itself has settled to this merchant, lifetime. */
  totalSettled: bigint;
  loans: MerchantLoan[];
  financed: bigint;
  outstanding: bigint;
  collected: bigint;
  active_count: number;
  repaid_count: number;
  liquidated_count: number;
};

const big = (v: any): bigint => BigInt(v?.toString?.() ?? v ?? 0);

/** Reads the merchant account and every loan financed against it. */
export async function readMerchantBook(
  chain: Chain,
  address: PublicKey
): Promise<MerchantBook | null> {
  let merchant: any;
  try {
    merchant = await (chain.program.account as any).merchant.fetch(address);
  } catch {
    return null;
  }

  /*
   * Every loan, filtered here rather than by a memcmp on the borrower offset.
   * The book is small enough that one getProgramAccounts is cheaper than
   * getting the offset wrong, and a wrong offset fails silently by returning
   * an empty book — which would read as "this merchant has no trade".
   */
  const all = await (chain.program.account as any).loan.all();
  const mine = all.filter((l: any) => l.account.merchant.equals(address));

  const loans: MerchantLoan[] = mine
    .map((l: any) => ({
      id: Number(big(l.account.id)),
      borrower: l.account.borrower.toBase58(),
      status: Object.keys(l.account.status)[0] ?? "unknown",
      principal: big(l.account.principal),
      owed: big(l.account.totalOwed),
      repaid: big(l.account.totalRepaid),
      installmentsPaid: l.account.installmentsPaid,
      installmentCount: l.account.installmentCount,
      startedAt: Number(big(l.account.startedAt)),
      intervalSeconds: Number(big(l.account.intervalSeconds)),
    }))
    .sort((a: MerchantLoan, b: MerchantLoan) => b.startedAt - a.startedAt);

  const sum = (pick: (l: MerchantLoan) => bigint) =>
    loans.reduce((t, l) => t + pick(l), 0n);

  return {
    address: address.toBase58(),
    name: merchant.name,
    payout: merchant.payout.toBase58(),
    authority: merchant.authority.toBase58(),
    active: merchant.active,
    maxOrderValue: big(merchant.maxOrderValue),
    totalSettled: big(merchant.totalSettled),
    loans,
    financed: sum((l) => l.principal),
    outstanding: sum((l) => (l.status === "active" ? l.owed - l.repaid : 0n)),
    collected: sum((l) => l.repaid),
    active_count: loans.filter((l) => l.status === "active").length,
    repaid_count: loans.filter((l) => l.status === "repaid").length,
    liquidated_count: loans.filter((l) => l.status === "liquidated").length,
  };
}

/**
 * Every merchant registered on this deployment, read from chain.
 *
 * Deliberately not the seed file: that is a snapshot of one `reset-local.sh`
 * run and goes stale the moment anybody registers a merchant another way.
 */
export async function listMerchants(
  chain: Chain
): Promise<{ name: string; pda: string }[]> {
  const all = await (chain.program.account as any).merchant.all();
  return all
    .map((m: any) => ({ name: String(m.account.name), pda: m.publicKey.toBase58() }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
}
