// Side-effect import, and it must come first: these modules pull in
// @solana/web3.js, which captures the global Buffer as it evaluates. If it
// loads before the polyfill, account data arrives as a plain Uint8Array and
// buffer-layout dies on `b.readUIntLE is not a function` — deep inside a
// borsh decode, nowhere near the cause.
import "./polyfills";

import { BN } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  createApproveInstruction,
} from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";

import { getProgram, getProvider, getTokenAccount, getWallet } from "./client";
import { TREASURY } from "./config";
import { pdas } from "./pdas";
import { interestFor } from "./math";
import { fetchProfile, fetchProtocol } from "./queries";

export type ActionResult = { signature: string };

/**
 * A merchant order reference: exactly 32 bytes.
 *
 * Short ids go in directly, right-aligned, so the payment address is derivable
 * from the order id alone. Anything longer is hashed — never truncated, which
 * would make two long ids sharing a prefix the same order and get the second
 * payment refused as a duplicate.
 */
export function orderRef(orderId: string): Buffer {
  const bytes = Buffer.from(orderId, "utf8");
  if (bytes.length <= 32) {
    const out = Buffer.alloc(32);
    bytes.copy(out, 32 - bytes.length);
    return out;
  }
  // Deliberately not a crypto hash: RN has no synchronous SHA-256 and the only
  // requirement is a stable 32-byte reference. FNV-1a over four lanes gives
  // that without pulling a hashing library into the bundle.
  const out = Buffer.alloc(32);
  for (let lane = 0; lane < 8; lane++) {
    let h = 0x811c9dc5 ^ lane;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out.writeUInt32BE(h >>> 0, lane * 4);
  }
  return out;
}

/** Pay a merchant in full, now. One instruction, signed by the payer. */
export async function payNow(params: {
  merchant: PublicKey;
  merchantPayout: PublicKey;
  amount: number;
  orderId: string;
}): Promise<ActionResult> {
  const ref = orderRef(params.orderId);
  const signature = await getProgram().methods
    .pay(new BN(params.amount), Array.from(ref))
    .accountsPartial({
      payer: getWallet().publicKey,
      protocol: pdas.protocol,
      merchant: params.merchant,
      payment: pdas.paymentOf(params.merchant, ref),
      payerTokenAccount: getTokenAccount(),
      merchantPayout: params.merchantPayout,
      treasury: TREASURY,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: new PublicKey("11111111111111111111111111111111"),
    })
    .signers([getWallet()])
    .rpc();
  return { signature };
}

/**
 * Split a purchase into installments, and pay the merchant now.
 *
 * The SPL `Approve` and the origination go in **one transaction**. On EVM these
 * were two, sent in order, and a checkout that dropped the second left a
 * standing allowance with no loan attached to it. Here they both land or
 * neither does, and the borrower signs once.
 *
 * The delegation is sized against everything the borrower owes, not just this
 * purchase: one delegate slot backs every open plan at once, so sizing it for a
 * single plan is how a book ends up with loans it cannot collect.
 */
export async function payLater(params: {
  merchant: PublicKey;
  merchantPayout: PublicKey;
  amount: number;
  installmentCount?: number;
  intervalSeconds?: number;
}): Promise<ActionResult & { loanId: number }> {
  const installmentCount = params.installmentCount ?? 4;
  const intervalSeconds = params.intervalSeconds ?? 7 * 86_400;

  const [protocol, profile] = await Promise.all([fetchProtocol(), fetchProfile()]);
  const interest = interestFor(params.amount, installmentCount * intervalSeconds);
  // No profile means no debt to size the delegation against, not an error: the
  // program opens the account as part of this very transaction.
  const required = (profile?.activeDebt ?? 0) + params.amount + interest;

  const loanId = protocol.loanCount;

  const approve = createApproveInstruction(
    getTokenAccount(),
    pdas.protocol,
    getWallet().publicKey,
    BigInt(required),
  );

  const originate = await getProgram().methods
    .createLoan(new BN(params.amount), installmentCount, new BN(intervalSeconds))
    .accountsPartial({
      borrower: getWallet().publicKey,
      payer: getWallet().publicKey,
      protocol: pdas.protocol,
      profile: pdas.profileOf(getWallet().publicKey),
      merchant: params.merchant,
      loan: pdas.loanOf(loanId),
      borrowerTokenAccount: getTokenAccount(),
      liquidityVault: pdas.liquidityVault,
      merchantPayout: params.merchantPayout,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: new PublicKey("11111111111111111111111111111111"),
    })
    .instruction();

  const tx = new Transaction().add(approve, originate);
  const signature = await getProvider().sendAndConfirm(tx, [getWallet()]);
  return { signature, loanId };
}

/**
 * Subscribe, paying period one immediately.
 *
 * The delegation covers a bounded number of periods rather than being
 * unlimited, and the subscriber can cancel at any time without the merchant's
 * agreement. That combination is what makes a standing authorisation safe to
 * grant, and it is what recurring crypto payments normally cannot offer.
 */
export async function subscribeToPlan(params: {
  plan: PublicKey;
  merchant: PublicKey;
  merchantPayout: PublicKey;
  pricePerPeriod: number;
  periods?: number;
}): Promise<ActionResult> {
  const periods = params.periods ?? 12;
  const profile = await fetchProfile();
  const authorize = (profile?.activeDebt ?? 0) + params.pricePerPeriod * periods;

  const approve = createApproveInstruction(
    getTokenAccount(),
    pdas.protocol,
    getWallet().publicKey,
    BigInt(authorize),
  );

  const sub = await getProgram().methods
    .subscribe()
    .accountsPartial({
      subscriber: getWallet().publicKey,
      protocol: pdas.protocol,
      merchant: params.merchant,
      plan: params.plan,
      subscription: pdas.subOf(getWallet().publicKey, params.plan),
      subscriberTokenAccount: getTokenAccount(),
      merchantPayout: params.merchantPayout,
      treasury: TREASURY,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: new PublicKey("11111111111111111111111111111111"),
    })
    .instruction();

  const signature = await getProvider().sendAndConfirm(
    new Transaction().add(approve, sub),
    [getWallet()],
  );
  return { signature };
}

/**
 * Turn a program error into something a borrower can act on.
 *
 * Anchor puts the error name in the logs; the raw message is a hex code and a
 * stack of program ids, which tells a user nothing.
 */
export function explainError(e: any): string {
  const text = `${e?.message ?? e}\n${(e?.logs ?? []).join("\n")}`;
  const code = text.match(/Error Code: (\w+)/)?.[1];
  const map: Record<string, string> = {
    ExceedsCreditLimit: "That is more credit than your limit allows.",
    InsufficientDelegation: "Your payment authorisation does not cover this.",
    NotDelegated: "Your account is not authorised for Polaris yet.",
    InsufficientLiquidity: "The protocol pool cannot cover this purchase right now.",
    MerchantNotEligible: "This merchant cannot take a plan of that size.",
    InvalidInstallments: "Between 1 and 24 installments.",
    InvalidInterval: "That schedule is outside what the protocol allows.",
    ZeroAmount: "Enter an amount above zero.",
    AlreadySubscribed: "You already have a live subscription to this plan.",
  };
  if (code && map[code]) return map[code];
  if (/already in use/i.test(text)) return "That order has already been paid.";
  if (/insufficient funds|0x1\b/.test(text)) return "Your balance does not cover this.";
  if (code) return code;
  return e?.message ?? "The transaction was refused.";
}
