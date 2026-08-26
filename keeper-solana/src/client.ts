/**
 * The execution client.
 *
 * On EVM this was a wrapper around KeeperHub, a platform that sold five things:
 * simulation before execution, atomic check-and-execute, gas-sponsored sends,
 * idempotency keys, and terminal status reconciliation. Every one of those
 * exists on Solana without a vendor, and this file is where that shows up:
 *
 *   simulate            -> connection.simulateTransaction, a native RPC method
 *   check-and-execute   -> gone. The condition is a require! inside the
 *                          instruction, so there is no window to close and
 *                          nothing for a platform to make atomic
 *   sponsored send      -> the fee payer is simply a different signer from the
 *                          token authority. The keeper holds SOL and no USDC,
 *                          touches no borrower balance, and still lands the tx
 *   idempotency keys    -> replay protection is a runtime property. A signed
 *                          transaction lands at most once per blockhash
 *   terminal status     -> getSignatureStatuses at `finalized`
 *   receipts            -> the signature is the receipt
 *
 * What is left is what a keeper should always have been: decide what is due,
 * price the priority fee, send it, and read the result honestly.
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
// A type, not a value. Imported as a value it survives type-stripping as a
// real runtime import, and @solana/web3.js is CommonJS — so the named export
// does not exist and the process refuses to start.
import type { TransactionSignature } from "@solana/web3.js";

import { classify, type ClassifiedError } from "./errors.ts";

export type Receipt = {
  ok: boolean;
  signature?: TransactionSignature;
  /** Compute units the simulation said this would burn. */
  computeUnits?: number;
  priorityMicroLamports?: number;
  slot?: number;
  error?: ClassifiedError;
  /** A line safe to print into an operator log. */
  summary: string;
};

export type ExecuteOptions = {
  label: string;
  /** Skip the send and report what simulation said. */
  dryRun?: boolean;
  /** Hard ceiling on the priority fee, so a congested hour cannot bankrupt us. */
  maxPriorityMicroLamports?: number;
  /** Extra signers beyond the fee payer. */
  signers?: Keypair[];
};

export class PolarisKeeperClient {
  /*
   * Fields declared and assigned explicitly rather than as constructor
   * parameter properties.
   *
   * The package's own scripts run this with `node --experimental-strip-types`,
   * which erases type annotations without transforming anything — and a
   * parameter property is a transform, not an annotation. It typechecks fine
   * and then refuses to load, so the keeper was not runnable at all.
   */
  readonly connection: Connection;
  readonly payer: Keypair;
  readonly opts: { commitment?: "confirmed" | "finalized" };

  constructor(
    connection: Connection,
    payer: Keypair,
    opts: { commitment?: "confirmed" | "finalized" } = {},
  ) {
    this.connection = connection;
    this.payer = payer;
    this.opts = opts;
  }

  /**
   * Price the priority fee from what the network is actually charging for the
   * accounts this transaction touches, rather than a fixed guess.
   *
   * This is the Solana shape of the problem KeeperHub called a "gas spike": a
   * transaction that is under-priced does not fail, it simply never lands, and
   * an installment that never lands is indistinguishable from one that was
   * never attempted until somebody checks.
   */
  async priorityFee(accounts: PublicKey[], ceiling = 200_000): Promise<number> {
    try {
      const recent = await this.connection.getRecentPrioritizationFees({
        lockedWritableAccounts: accounts.slice(0, 128),
      });
      if (!recent.length) return 1_000;
      const fees = recent.map((f) => f.prioritizationFee).sort((a, b) => a - b);
      // 75th percentile: land reliably without paying the top of the book.
      const p75 = fees[Math.min(fees.length - 1, Math.floor(fees.length * 0.75))];
      return Math.min(ceiling, Math.max(1_000, p75));
    } catch {
      return 1_000;
    }
  }

  /**
   * Dry-run first, always.
   *
   * A borrower who is short becomes a dunning event rather than a burnt
   * transaction, and the compute estimate comes back in the same call so the
   * budget can be set from measurement instead of a round number.
   */
  async simulate(
    ixs: TransactionInstruction[],
    signers: Keypair[] = [],
  ): Promise<{ ok: boolean; computeUnits?: number; error?: ClassifiedError; logs?: string[] }> {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = this.payer.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.sign(this.payer, ...signers);

    const sim = await this.connection.simulateTransaction(tx);
    if (sim.value.err) {
      const err = classify({
        message: JSON.stringify(sim.value.err),
        logs: sim.value.logs ?? [],
      });
      return { ok: false, error: err, logs: sim.value.logs ?? undefined };
    }
    return {
      ok: true,
      computeUnits: sim.value.unitsConsumed ?? undefined,
      logs: sim.value.logs ?? undefined,
    };
  }

  /**
   * Simulate, then send, then confirm to a terminal status.
   *
   * The confirmation is not optional politeness. A signature that has been
   * submitted is not a collection; only a finalized signature is. The EVM
   * build learned this the hard way — sponsored sends were invisible to the
   * keeper's wallet, so verifying a charge by checking the wallet reported
   * every success as a failure. Here the equivalent trap is treating "the RPC
   * accepted my transaction" as "the money moved".
   */
  async execute(
    ixs: TransactionInstruction[],
    writableAccounts: PublicKey[],
    opts: ExecuteOptions,
  ): Promise<Receipt> {
    const signers = opts.signers ?? [];

    const sim = await this.simulate(ixs, signers);
    if (!sim.ok) {
      return {
        ok: false,
        error: sim.error,
        summary: `${opts.label}: refused by simulation — ${sim.error?.kind} — ${sim.error?.message}`,
      };
    }

    const micro = await this.priorityFee(
      writableAccounts,
      opts.maxPriorityMicroLamports ?? 200_000,
    );
    // 20% headroom over what simulation measured, floored so a cheap
    // instruction is not starved by its own estimate.
    const units = Math.max(20_000, Math.ceil((sim.computeUnits ?? 200_000) * 1.2));

    if (opts.dryRun) {
      return {
        ok: true,
        computeUnits: sim.computeUnits,
        priorityMicroLamports: micro,
        summary: `${opts.label}: DRY RUN — would land, ${sim.computeUnits ?? "?"} CU at ${micro} µlamports/CU`,
      };
    }

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units }))
      .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: micro }))
      .add(...ixs);

    const latest = await this.connection.getLatestBlockhash();
    tx.feePayer = this.payer.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(this.payer, ...signers);

    try {
      const signature = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true, // already simulated; preflight would double the work
        maxRetries: 3,
      });

      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        this.opts.commitment ?? "confirmed",
      );

      if (confirmation.value.err) {
        const status = await this.connection.getSignatureStatus(signature);
        return {
          ok: false,
          signature,
          error: classify({
            message: JSON.stringify(confirmation.value.err),
            logs: [],
          }),
          slot: status.value?.slot,
          summary: `${opts.label}: landed but failed — ${signature}`,
        };
      }

      const status = await this.connection.getSignatureStatus(signature);
      return {
        ok: true,
        signature,
        computeUnits: sim.computeUnits,
        priorityMicroLamports: micro,
        slot: status.value?.slot,
        summary: `${opts.label}: ok — ${signature}`,
      };
    } catch (e) {
      const err = classify(e);
      return {
        ok: false,
        error: err,
        summary: `${opts.label}: ${err.kind} — ${err.message}`,
      };
    }
  }

  /**
   * Ask the chain what happened to a signature we already sent.
   *
   * This is the recovery path for the one failure that must never be retried
   * blind: a send that timed out. The transaction may still be settling, and
   * sending it again is how a borrower gets charged twice for one installment.
   */
  async reconcile(signature: TransactionSignature): Promise<Receipt> {
    const status = await this.connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });
    const v = status.value;
    if (!v) {
      return {
        ok: false,
        signature,
        error: { kind: "indefinite", message: "The cluster has no record of this signature." },
        summary: `reconcile ${signature}: no record — safe to resend`,
      };
    }
    if (v.err) {
      return {
        ok: false,
        signature,
        slot: v.slot,
        error: classify({ message: JSON.stringify(v.err) }),
        summary: `reconcile ${signature}: landed and failed`,
      };
    }
    return {
      ok: true,
      signature,
      slot: v.slot,
      summary: `reconcile ${signature}: confirmed at slot ${v.slot} (${v.confirmationStatus})`,
    };
  }
}
