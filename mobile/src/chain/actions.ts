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
import { explainError } from "./explain";
import { interestFor } from "./math";
import { fetchProfile, fetchProtocol } from "./queries";

export { explainError };

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
  /**
   * The order this plan is for, so a retry is the *same* order.
   *
   * Minted here when absent, which is right for a first attempt and wrong for
   * a second: a fresh reference each time means the program's duplicate-order
   * refusal never engages, and a borrower retrying after a confirmation they
   * could not read opens a second real loan. Callers that can retry pass the
   * reference they used the first time.
   */
  orderRef?: Uint8Array;
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
      Array.from(params.orderRef ?? randomOrderRef()),
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
 * Pay a plan off early.
 *
 * Interest is annualised and pro-rated over the elapsed term, so settling on
 * day nine of a ninety-day plan costs nine days of interest — a real saving
 * the program already computes and the app previously gave no way to take.
 * Both screens told a refused borrower to "repay a plan"; neither offered a
 * button that did it.
 */
export async function repayLoan(loanId: number, amount: number): Promise<ActionResult> {
  const signature = await getProgram()
    .methods.repay(new BN(amount))
    .accountsPartial({
      borrower: getPublicKey(),
      protocol: pdas.protocol,
      profile: pdas.profileOf(getPublicKey()),
      loan: pdas.loanOf(loanId),
      borrowerTokenAccount: getTokenAccount(),
      liquidityVault: pdas.liquidityVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  return { signature };
}

/**
 * Cancel a subscription.
 *
 * The subscribe screen promises "you can cancel at any time without the
 * merchant's agreement", and the plans screen repeats it. That is true of the
 * program — `cancel_subscription` takes the subscriber's signature and does not
 * consult the merchant — and it was not true of the app, which offered no way
 * to do it. A standing authorization you cannot revoke from the thing that
 * granted it is the exact fear this product exists to answer.
 */
export async function cancelSubscription(params: {
  /**
   * The plan's id, not an address.
   *
   * A subscription row carries `address` for the *Subscription* account, and
   * passing that as the plan gets AccountDiscriminatorMismatch — Anchor
   * checking a Subscription against the Plan layout. The id is unambiguous and
   * both PDAs derive from it.
   */
  planId: number;
  merchant: PublicKey;
}): Promise<ActionResult> {
  const plan = pdas.planOf(params.planId);
  const signature = await getProgram()
    .methods.cancelSubscription()
    .accountsPartial({
      signer: getPublicKey(),
      merchant: params.merchant,
      plan,
      subscription: pdas.subOf(getPublicKey(), plan),
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
    /*
     * `transactionLogs` as well as `logs`.
     *
     * web3.js's SendTransactionError does not expose the program's output as
     * `.logs` at all — it carries `signature`, `transactionMessage` and
     * `transactionLogs`, and `getLogs()` returns an empty array once the
     * error has already been constructed with them. Reading only `.logs`
     * meant every send failure on a device collapsed to the bare words
     * "Simulation failed." and then to "The cluster refused that", with the
     * program's own reason sitting unread on the error the whole time.
     */
    if (Array.isArray(carrier.transactionLogs) && carrier.transactionLogs.length > 0) {
      e.logs = carrier.transactionLogs;
      break;
    }
    if (typeof carrier.transactionMessage === "string" && carrier.transactionMessage) {
      e.logs = [carrier.transactionMessage];
      break;
    }
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
