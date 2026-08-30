import { PublicKey } from "@solana/web3.js";

import { chain } from "./readonly";

/**
 * The merchant's book, read straight off chain.
 *
 * Ported from the gateway's `readMerchantBook` so the app and the web POS
 * agree by construction rather than by two people implementing the same sums.
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
  active: boolean;
  loans: MerchantLoan[];
  financed: bigint;
  outstanding: bigint;
  collected: bigint;
  activeCount: number;
  repaidCount: number;
  liquidatedCount: number;
};

export type MerchantRow = { address: string; name: string; active: boolean };

const big = (v: any): bigint => BigInt(v?.toString?.() ?? v ?? 0);

const readName = (name: unknown): string => {
  if (typeof name === "string") return name;
  if (Array.isArray(name)) {
    const bytes = name.filter((b: number) => b !== 0);
    return Buffer.from(bytes).toString("utf8");
  }
  return "Merchant";
};

/** Every merchant registered on this deployment. Read from chain, not a seed file. */
export async function listMerchants(): Promise<MerchantRow[]> {
  const { program } = chain();
  const all = await (program.account as any).merchant.all();
  return all
    .map((m: any) => ({
      address: m.publicKey.toBase58(),
      name: readName(m.account.name),
      active: Boolean(m.account.active),
    }))
    .sort((a: MerchantRow, b: MerchantRow) => a.name.localeCompare(b.name));
}

/** The merchant account plus every loan financed against it. */
export async function readMerchantBook(address: string): Promise<MerchantBook | null> {
  const { program } = chain();
  const key = new PublicKey(address);

  let merchant: any;
  try {
    merchant = await (program.account as any).merchant.fetch(key);
  } catch {
    return null;
  }

  /*
   * Filtered in JS rather than by a memcmp on the merchant offset: the book is
   * small, and a wrong offset fails silently by returning nothing — which
   * reads as "this merchant has no trade" instead of as a bug.
   */
  const all = await (program.account as any).loan.all();
  const mine = all.filter((l: any) => l.account.merchant.equals(key));

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
    address: key.toBase58(),
    name: readName(merchant.name),
    payout: merchant.payout.toBase58(),
    active: Boolean(merchant.active),
    loans,
    financed: sum((l) => l.principal),
    outstanding: sum((l) => (l.status === "active" ? l.owed - l.repaid : 0n)),
    collected: sum((l) => l.repaid),
    activeCount: loans.filter((l) => l.status === "active").length,
    repaidCount: loans.filter((l) => l.status === "repaid").length,
    liquidatedCount: loans.filter((l) => l.status === "liquidated").length,
  };
}
