import { BN } from "@coral-xyz/anchor";
import {
  createApproveInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import type { Chain } from "./chain.ts";
import { orderRef } from "./order.ts";

export type Order = {
  /** The merchant's registry PDA. */
  merchant: PublicKey;
  amount: bigint;
  orderId: string;
  mode: "full" | "later";
  installmentCount: number;
  intervalSeconds: number;
};

/**
 * Build the transaction a Solana Pay wallet is asked to sign.
 *
 * Two things make this worth doing rather than sending the customer to a web
 * checkout. The first is that the wallet never has to trust a page: it is
 * handed one transaction, and it can decode every instruction in it before the
 * customer approves anything. The second is the fee payer.
 *
 * The gateway pays the fee and partially signs. On EVM this was a product we
 * bought -- gas sponsorship, one of five things the keeper platform was for.
 * Here it is a field: the fee payer simply differs from the token authority,
 * and the customer needs no SOL to open a plan or pay an invoice.
 */
export async function buildPaymentTransaction(
  chain: Chain,
  order: Order,
  customer: PublicKey
): Promise<{ transaction: Transaction; message: string }> {
  const protocolPda = chain.pda([Buffer.from("protocol")]);
  const protocol: any = await chain.program.account.protocol.fetch(protocolPda);
  const merchant: any = await chain.program.account.merchant.fetch(order.merchant);

  const mint = new PublicKey(protocol.stablecoin);
  const customerAta = getAssociatedTokenAddressSync(mint, customer, true);

  const instructions: TransactionInstruction[] =
    order.mode === "full"
      ? [await payInFull(chain, order, customer, customerAta, merchant, protocolPda, protocol)]
      : await splitIntoInstallments(chain, order, customer, customerAta, merchant, protocolPda, protocol);

  const tx = new Transaction();
  tx.add(...instructions);
  /*
   * The customer is not the fee payer. Solana Pay lets the response carry a
   * partially signed transaction, so the gateway signs as fee payer here and
   * the wallet adds the only signature that matters -- the token authority's.
   */
  tx.feePayer = chain.underwriter.publicKey;
  tx.recentBlockhash = (await chain.connection.getLatestBlockhash("finalized")).blockhash;
  tx.partialSign(chain.underwriter);

  return { transaction: tx, message: describe(order, merchant) };
}

async function payInFull(
  chain: Chain,
  order: Order,
  customer: PublicKey,
  customerAta: PublicKey,
  merchant: any,
  protocolPda: PublicKey,
  protocol: any
): Promise<TransactionInstruction> {
  const ref = orderRef(order.orderId);
  const paymentPda = chain.pda([Buffer.from("payment"), order.merchant.toBuffer(), ref]);

  return chain.program.methods
    .pay(new BN(order.amount.toString()), Array.from(ref))
    .accountsPartial({
      payer: customer,
      protocol: protocolPda,
      merchant: order.merchant,
      payment: paymentPda,
      payerTokenAccount: customerAta,
      merchantPayout: merchant.payout,
      // The protocol's fee share on a direct payment goes to the treasury, not
      // into lending liquidity: it is revenue, not capital to lend out.
      treasury: new PublicKey(protocol.treasury),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

async function splitIntoInstallments(
  chain: Chain,
  order: Order,
  customer: PublicKey,
  customerAta: PublicKey,
  merchant: any,
  protocolPda: PublicKey,
  protocol: any
): Promise<TransactionInstruction[]> {
  const profilePda = chain.pda([Buffer.from("profile"), customer.toBuffer()]);
  const profile: any = await chain.program.account.creditProfile.fetchNullable(profilePda);

  const owed = totalOwed(order.amount, order.installmentCount, order.intervalSeconds);
  const activeDebt = profile ? BigInt(profile.activeDebt.toString()) : 0n;

  /*
   * Sized against everything this borrower owes, not just this purchase. One
   * SPL token account holds exactly one delegate, so a delegation sized for a
   * single plan silently under-funds every other plan already collecting
   * against it. This is the single most important line in the file.
   */
  const approve = createApproveInstruction(
    customerAta,
    protocolPda,
    customer,
    activeDebt + owed
  );

  const loanId = Number(protocol.loanCount.toString());
  const u64 = (n: number) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };

  const originate = await chain.program.methods
    .createLoan(new BN(order.amount.toString()), order.installmentCount, new BN(order.intervalSeconds))
    .accountsPartial({
      borrower: customer,
      // The gateway pays the rent as well as the fee. That is the difference
      // between "the customer needs almost no SOL" and "the customer needs
      // none", and for a shopper who has never held SOL it is the whole
      // difference.
      payer: chain.underwriter.publicKey,
      protocol: protocolPda,
      profile: profilePda,
      merchant: order.merchant,
      loan: chain.pda([Buffer.from("loan"), u64(loanId)]),
      borrowerTokenAccount: customerAta,
      liquidityVault: chain.pda([Buffer.from("liquidity")]),
      merchantPayout: merchant.payout,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  // Both, or neither. A delegation that lands without its loan is a standing
  // authorization the customer never got anything for.
  return [approve, originate];
}

/** Mirrors `math.rs`: annualised, pro-rated over the term, ceiled. */
export function totalOwed(principal: bigint, installments: number, intervalSeconds: number): bigint {
  const term = BigInt(installments) * BigInt(intervalSeconds);
  const interest = (principal * 1_000n * term) / (10_000n * 365n * 86_400n);
  return principal + interest;
}

function describe(order: Order, merchant: any): string {
  const name = decodeName(merchant.name);
  const amount = (Number(order.amount) / 1e6).toFixed(2);
  if (order.mode === "full") return `${name} — ${amount} USDC`;
  const each = (Number(totalOwed(order.amount, order.installmentCount, order.intervalSeconds)) / 1e6 / order.installmentCount).toFixed(2);
  return `${name} — ${amount} USDC in ${order.installmentCount} payments of ${each}`;
}

function decodeName(name: unknown): string {
  if (typeof name === "string") return name;
  if (Array.isArray(name)) return Buffer.from(name).toString("utf8").replace(/\0+$/, "");
  return "Merchant";
}
