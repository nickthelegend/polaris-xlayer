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
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";

import { getProgram, getProvider, getPublicKey, getTokenAccount } from "./client";
import { TREASURY } from "./config";
import { pdas } from "./pdas";

/**
 * 32 random bytes, from the platform's own CSPRNG.
 *
 * `react-native-get-random-values` is installed by the polyfill above, so
 * `crypto.getRandomValues` is real on device as well as on web. Not
 * `node:crypto` — that does not exist here.
 */
function randomOrderRef(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}
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
      payer: getPublicKey(),
      protocol: pdas.protocol,
      merchant: params.merchant,
      payment: pdas.paymentOf(params.merchant, ref),
      payerTokenAccount: getTokenAccount(),
      merchantPayout: params.merchantPayout,
      treasury: TREASURY,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: new PublicKey("11111111111111111111111111111111"),
    })
    /*
     * No `signers` array.
     *
     * The provider's wallet is this same account and Anchor already signs with
     * it. Passing a keypair here as well was redundant with a device key and
     * impossible with a wallet app, which never exposes one.
     */
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
    getPublicKey(),
    BigInt(required),
  );

  const originate = await getProgram().methods
    /*
     * A reference unique to this checkout.
     *
     * The program refuses to finance the same (merchant, order) twice, which
     * is what stops a re-scanned Solana Pay code opening a second plan. A
     * checkout typed into this app has no merchant basket id, so it gets a
     * random one — two taps are two orders here, and the double-submit guard
     * in the screen is what stops the second one.
     */
    .createLoan(
      new BN(params.amount),
      installmentCount,
      new BN(intervalSeconds),
      Array.from(randomOrderRef()),
    )
    .accountsPartial({
      borrower: getPublicKey(),
      payer: getPublicKey(),
      protocol: pdas.protocol,
      profile: pdas.profileOf(getPublicKey()),
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
  const signature = await getProvider().sendAndConfirm(tx);
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
    getPublicKey(),
    BigInt(authorize),
  );

  const sub = await getProgram().methods
    .subscribe()
    .accountsPartial({
      subscriber: getPublicKey(),
      protocol: pdas.protocol,
      merchant: params.merchant,
      plan: params.plan,
      subscription: pdas.subOf(getPublicKey(), params.plan),
      subscriberTokenAccount: getTokenAccount(),
      merchantPayout: params.merchantPayout,
      treasury: TREASURY,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: new PublicKey("11111111111111111111111111111111"),
    })
    .instruction();

  const signature = await getProvider().sendAndConfirm(
    new Transaction().add(approve, sub),
  );
  return { signature };
}

/**
 * Lock stablecoin as collateral, raising the credit limit.
 *
 * The app displayed a collateral figure and told a refused borrower to "lock
 * collateral to raise the limit" without offering any way to do it — a screen
 * naming an action the product could not perform. The instruction, the SDK and
 * the tests all had it; only the app did not.
 *
 * Collateral is not a payment. It stays the borrower's, sits in a vault held
 * apart from lending liquidity, and comes back out with `withdrawCollateral`
 * once nothing is owed against it.
 */
export async function lockCollateral(amount: number): Promise<ActionResult> {
  const signature = await getProgram()
    .methods.lockCollateral(new BN(amount))
    .accountsPartial({
      user: getPublicKey(),
      protocol: pdas.protocol,
      profile: pdas.profileOf(getPublicKey()),
      from: getTokenAccount(),
      collateralVault: pdas.collateralVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  return { signature };
}

/** Take it back. The program refuses while it is still backing a debt. */
export async function withdrawCollateral(amount: number): Promise<ActionResult> {
  const signature = await getProgram()
    .methods.withdrawCollateral(new BN(amount))
    .accountsPartial({
      user: getPublicKey(),
      protocol: pdas.protocol,
      profile: pdas.profileOf(getPublicKey()),
      collateralVault: pdas.collateralVault,
      to: getTokenAccount(),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  return { signature };
}

/**
 * Turn a program error into something a borrower can act on.
 *
 * Anchor puts the error name in the logs; the raw message is a hex code and a
 * stack of program ids, which tells a user nothing.
 */
export function explainError(e: any): string {
  /*
   * `getLogs()` as well as `.logs`.
   *
   * web3.js throws SendTransactionError, whose `logs` are often not populated
   * until something asks for them — so the program's own error name was
   * missing from the text this matches on, and every failed simulation
   * collapsed to the words "Simulation failed", which tells a borrower
   * nothing. `logs` is a plain property once resolved; reading both covers
   * the case where it already is.
   */
  const fromGetter = typeof e?.getLogs === "function" ? safeLogs(e) : [];
  const logs: string[] = e?.logs ?? fromGetter ?? [];
  const text = `${e?.message ?? e}\n${logs.join("\n")}`;
  const code = text.match(/Error Code: (\w+)/)?.[1];
  const map: Record<string, string> = {
    AccountNotInitialized: "This wallet has no USDC account yet. Add some and try again.",
    ExceedsCreditLimit: "That is more credit than your limit allows.",
    InsufficientDelegation: "Your payment authorisation does not cover this.",
    NotDelegated: "Your account is not authorised for Polaris yet.",
    InsufficientLiquidity: "The protocol pool cannot cover this purchase right now.",
    MerchantNotEligible: "This merchant cannot take a plan of that size.",
    InvalidInstallments: "Between 1 and 24 installments.",
    InvalidInterval: "That schedule is outside what the protocol allows.",
    ZeroAmount: "Enter an amount above zero.",
    AlreadySubscribed: "You already have a live subscription to this plan.",

    /*
     * The rest of the program's errors.
     *
     * Twenty of twenty-nine had no sentence, and the fallback below returned
     * the raw identifier — so withdrawing collateral against an open plan told
     * the borrower "DebtOutstanding". Every one of these is reachable from a
     * screen, so every one gets words.
     */
    DebtOutstanding: "You still owe on a plan. Repay it before withdrawing collateral.",
    InsufficientCollateral: "That is more collateral than you have locked.",
    LoanNotActive: "That plan is already closed.",
    NotLiquidatable: "That plan is not overdue enough to liquidate.",
    PlanNotActive: "That subscription plan is no longer offered.",
    SubscriptionNotActive: "That subscription is not running.",
    NotDue: "That charge is not due yet.",
    NotAuthorized: "This account is not allowed to do that.",
    InvalidPeriod: "That billing period is outside what the protocol allows.",
    MathOverflow: "That amount is too large for the protocol to handle.",
    StringTooLong: "That name is too long.",
    TokenOwnerMismatch: "That token account belongs to somebody else.",
    MintMismatch: "That account holds a different token than this deployment uses.",
    AlreadyUnderwritten: "This wallet already has a credit line.",
    NotUnderwriter: "Only the underwriter can open a credit line.",
    EvidenceStale: "That credit check went stale. Try again.",
    EvidenceFromTheFuture: "That credit check is timestamped wrong. Try again.",

    // Set once at initialization, so a borrower can never see these — mapped
    // anyway, because the alternative is a bare identifier on a screen.
    InvalidGracePeriod: "This deployment is misconfigured.",
    InvalidFee: "This deployment is misconfigured.",
    InvalidMultiplier: "This deployment is misconfigured.",
  };
  if (code && map[code]) return map[code];
  if (/already in use/i.test(text)) return "That order has already been paid.";
  if (/insufficient funds|0x1\b/.test(text)) return "Your balance does not cover this.";
  if (/could not find account|AccountNotInitialized|invalid account data/i.test(text)) {
    return "This wallet has no USDC account yet. Add some and try again.";
  }
  // Not a borrower's problem, and not something they can retry into working:
  // the app is pointed at an address with no program on it.
  if (/program that does not exist|ProgramAccountNotFound/i.test(text)) {
    return "This app is pointed at the wrong program. Its deployment needs re-syncing.";
  }
  if (/blockhash not found|block height exceeded/i.test(text)) {
    return "That took too long to confirm. Nothing was charged — try again.";
  }
  if (/failed to fetch|network request failed|ECONNREFUSED/i.test(text)) {
    return "Cannot reach the network. Check the RPC endpoint is running.";
  }
  /*
   * Never the bare identifier.
   *
   * `return code` put things like "DebtOutstanding" on the screen — a symbol
   * from the program's source, shown to somebody trying to move their money.
   * Anything that reaches here is an error the map has not been taught yet,
   * and a sentence that admits that is better than a token that explains
   * nothing.
   */
  if (code) {
    if (__DEV__) console.error(`[polaris] unmapped program error: ${code}`, e);
    return "The program refused that. Nothing was charged.";
  }

  /*
   * Last resort, and the reason it is not just `e.message`.
   *
   * A simulation failure's message is a paragraph of logs, a hint about
   * catching SendTransactionError, and an empty array -- all of which landed
   * on the screen verbatim under the word "Refused". Anything that long is a
   * stack trace wearing a sentence, so it goes to the log and the borrower
   * gets something true and short.
   */
  const message = String(e?.message ?? "").split("\n")[0]?.trim() ?? "";
  /*
   * "Simulation failed." names nothing a borrower can act on, and it is
   * exactly the message that reaches here when the logs could not be found.
   * Better to say what is actually true.
   */
  if (/^simulation failed\.?$/i.test(message)) {
    return "The cluster refused that. Nothing was charged — check your balance and try again.";
  }
  if (message && message.length <= 120) return message;
  if (__DEV__) console.error("[polaris] unexplained failure:", e);
  return "The transaction was refused. Nothing was charged.";
}


/** `getLogs()` can itself throw when the RPC is gone; a diagnostic must not. */
function safeLogs(e: any): string[] {
  try {
    const logs = e.getLogs();
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

/**
 * Resolve a failure's logs, then explain it.
 *
 * `SendTransactionError.getLogs()` returns a **promise** on a fresh error, so
 * the synchronous reader above sees nothing and every simulation failure
 * collapsed to a bare "Simulation failed." — which names no cause and offers
 * no action. Awaiting once, here, is what lets `explainError` find the
 * program's own error name in the logs.
 *
 * Screens call this; `explainError` stays synchronous for the cases that
 * already carry their logs.
 */
export async function describeError(e: any): Promise<string> {
  /*
   * The logs are not always on the error you were handed.
   *
   * Anchor wraps the RPC's failure, so a simulation error can arrive as a bare
   * `Error("Simulation failed.")` with the program's own logs sitting on a
   * `cause`, on a `simulationResponse`, or behind an async `getLogs()`. Reading
   * only the outer `.logs` is why "no USDC account yet" — a case this file has
   * a sentence for — reached the screen as "Simulation failed." instead.
   */
  const carriers = [e, e?.cause, e?.simulationResponse, e?.cause?.simulationResponse];
  for (const carrier of carriers) {
    if (!carrier) continue;
    if (Array.isArray(carrier.logs) && carrier.logs.length > 0) {
      e.logs = carrier.logs;
      break;
    }
    if (typeof carrier.getLogs === "function") {
      try {
        const resolved = await carrier.getLogs();
        if (Array.isArray(resolved) && resolved.length > 0) {
          e.logs = resolved;
          break;
        }
      } catch {
        /* the RPC is gone; fall through to the next carrier */
      }
    }
  }
  return explainError(e);
}
