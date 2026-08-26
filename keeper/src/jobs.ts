/**
 * The keeper's jobs.
 *
 * Each one is a pure pass over its source of truth: read what is due, act
 * through KeeperHub, write back what happened. They are safe to run repeatedly
 * and safe to run concurrently with each other.
 */

import {
  type KeeperHubErrorKind,
  type PolarisKeeper,
  type Receipt,
  formatReceipt,
  isIndefinite,
  nextDunningStep,
  dunningMessage,
  partialCollection,
} from "@polarispay/keeperhub";

import type { LoanBook } from "./loanbook.ts";
import type { ChainSubscription } from "./subscriptions.ts";

export type JobResult = {
  job: string;
  considered: number;
  acted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  receipts: Receipt[];
};

export type Notifier = (message: string) => void | Promise<void>;

/**
 * Collect every installment that is due.
 *
 * The interesting part is the failure branch. A charge that fails is not
 * retried here -- it is handed to the dunning ladder, which decides whether
 * waiting will help, whether the borrower should hear about it, and whether the
 * loan has run out of road and should be liquidated instead.
 */
export async function runCollection(opts: {
  keeper: PolarisKeeper;
  book: LoanBook;
  now?: Date;
  dryRun?: boolean;
  notify?: Notifier;
  log?: (line: string) => void;
  /** Optional: lets the job attempt a partial collection on a shortfall. */
  availableBalanceRaw?: (borrower: string) => Promise<bigint>;
}): Promise<JobResult> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? console.log;
  const due = await opts.book.dueInstallments(now);

  const result: JobResult = {
    job: "collection",
    considered: due.length,
    acted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    receipts: [],
  };

  for (const { loan, installment } of due) {
    const attempt = installment.attempts + 1;

    /*
     * The idempotency key must not rotate while the previous outcome is
     * unknown.
     *
     * KeeperHub caches failures as well as successes, so a key that has already
     * failed replays that failure forever and a genuine retry can never
     * recover. Varying the key per attempt is the fix for that, and it is what
     * this did unconditionally.
     *
     * It is the wrong move after a timeout. A timed-out charge may still be
     * settling, and a fresh key has no record for KeeperHub to match, so the
     * call is executed a second time and the borrower is charged twice for one
     * instalment. Reusing the key is what makes that retry safe: it returns the
     * in-flight guard while the first request runs, and the real outcome once
     * it lands.
     *
     * So the key advances only on a definite failure.
     */
    const keyAttempt = isIndefinite(installment.lastFailureKind)
      ? installment.attempts
      : attempt;

    if (opts.dryRun) {
      log(
        `[dry-run] would collect ${installment.amountDisplay} for loan ${loan.loanId} installment ${installment.index} (attempt ${attempt})`
      );
      result.skipped++;
      continue;
    }

    const receipt = await opts.keeper.collectInstallment({
      loanId: loan.loanId,
      installment: installment.index,
      amountRaw: installment.amountRaw,
      amountDisplay: installment.amountDisplay,
      attempt: keyAttempt,
    });
    result.acted++;
    result.receipts.push(receipt);
    log(formatReceipt(receipt));

    if (receipt.outcome === "succeeded") {
      result.succeeded++;
      await opts.book.recordAttempt(loan.loanId, installment.index, {
        state: "paid",
        attempts: attempt,
        nextAttemptAt: undefined,
        lastFailureKind: undefined,
        // Without this a collected instalment has no link back to the
        // transaction that paid it, so neither the borrower nor the merchant
        // can go and check -- and "go and check" is the whole claim an on-chain
        // payments product is making.
        transactionHash: receipt.execution?.transactionHash,
      });
      continue;
    }

    result.failed++;
    const kind = (receipt.error?.kind ?? "unknown") as KeeperHubErrorKind;

    /*
     * Before falling through to dunning, try to collect what the borrower
     * actually has. A shortfall is not a default -- taking 38 of a 50
     * instalment reduces exposure and leaves less to chase, and the alternative
     * is taking nothing at all.
     *
     * Only on an insufficient-funds failure: any other revert means the
     * protocol rejected the call, and a smaller amount will be rejected too.
     */
    if (kind === "insufficient_funds" && opts.availableBalanceRaw) {
      const available = await opts.availableBalanceRaw(loan.borrower);
      const partial = partialCollection({
        dueRaw: BigInt(installment.amountRaw),
        availableRaw: available,
      });

      if (partial.action === "collect-partial") {
        const partialReceipt = await opts.keeper.collectInstallment({
          loanId: loan.loanId,
          installment: installment.index,
          amountRaw: partial.amountRaw,
          amountDisplay: `${partial.amountRaw} (partial)`,
          attempt: attempt + 1,
        });
        result.receipts.push(partialReceipt);
        log(`  -> partial collection: ${formatReceipt(partialReceipt)}`);

        if (partialReceipt.outcome === "succeeded") {
          // Still short, so the instalment stays open and the ladder still
          // applies -- but against a smaller remaining balance.
          await opts.book.recordAttempt(loan.loanId, installment.index, {
            state: "dunning",
            attempts: attempt + 1,
            lastFailureKind: "insufficient_funds",
          });
        }
      }
    }

    const decision = nextDunningStep({ attemptsMade: attempt, failureKind: kind, now });

    if (decision.action === "retry") {
      await opts.book.recordAttempt(loan.loanId, installment.index, {
        state: "dunning",
        attempts: attempt,
        nextAttemptAt: decision.at.toISOString(),
        lastFailureKind: kind,
      });
      if (decision.stage.notify && opts.notify) {
        await opts.notify(
          dunningMessage(decision.stage, {
            amount: installment.amountDisplay,
            loanId: loan.loanId,
          })
        );
      }
      log(
        `  -> dunning: ${decision.stage.label}, next attempt ${decision.at.toISOString()}`
      );
    } else if (decision.action === "escalate") {
      await opts.book.recordAttempt(loan.loanId, installment.index, {
        state: "dunning",
        attempts: attempt,
        lastFailureKind: kind,
      });
      await opts.book.markLiquidationCandidate(loan.loanId);
      log(`  -> escalated to liquidation: ${decision.reason}`);
    } else {
      await opts.book.recordAttempt(loan.loanId, installment.index, {
        attempts: attempt,
        lastFailureKind: kind,
      });
      log(`  -> abandoned: ${decision.reason}`);
    }
  }

  return result;
}

/**
 * Test every liquidation candidate and liquidate the ones the protocol agrees
 * are liquidatable.
 *
 * The decision is never made here. `checkLiquidatable` is evaluated on chain
 * inside the same KeeperHub call that would liquidate, so a borrower who repays
 * a second before this runs is not liquidated by a stale read.
 */
export async function runLiquidation(opts: {
  keeper: PolarisKeeper;
  book: LoanBook;
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<JobResult> {
  const log = opts.log ?? console.log;
  const candidates = await opts.book.liquidationCandidates();

  const result: JobResult = {
    job: "liquidation",
    considered: candidates.length,
    acted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    receipts: [],
  };

  for (const loan of candidates) {
    if (opts.dryRun) {
      log(`[dry-run] would test loan ${loan.loanId} for liquidation`);
      result.skipped++;
      continue;
    }
    const receipt = await opts.keeper.liquidateIfUnhealthy({ loanId: loan.loanId });
    result.acted++;
    result.receipts.push(receipt);
    log(formatReceipt(receipt));

    if (receipt.outcome === "succeeded") {
      result.succeeded++;
    } else if (receipt.outcome === "skipped") {
      result.skipped++;
    } else {
      result.failed++;
    }
  }

  return result;
}

/**
 * Charge every subscription that is due.
 *
 * The candidate list comes from the chain rather than a book, because nothing
 * originates a subscription off-chain -- a subscriber calls `subscribe`
 * themselves -- so a local list would be incomplete from the first one we did
 * not see.
 *
 * As with liquidation, the due test is not made here: `isChargeDue` is checked
 * on chain inside the same call that charges, so a subscription cancelled a
 * second before this runs is not charged on a stale read, and a race with
 * another keeper on a permissionless entry point costs nothing.
 */
export async function runSubscriptions(opts: {
  keeper: PolarisKeeper;
  subscriptions: ChainSubscription[];
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<JobResult> {
  const log = opts.log ?? console.log;

  const result: JobResult = {
    job: "subscriptions",
    considered: opts.subscriptions.length,
    acted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    receipts: [],
  };

  for (const sub of opts.subscriptions) {
    if (opts.dryRun) {
      log(
        `[dry-run] would test subscription ${sub.id} (plan ${sub.planId}, next charge ${new Date(
          sub.nextChargeAt * 1000
        ).toISOString()})`
      );
      result.skipped++;
      continue;
    }

    const receipt = await opts.keeper.chargeSubscription({ subscriptionId: sub.id });
    result.acted++;
    result.receipts.push(receipt);
    log(formatReceipt(receipt));

    if (receipt.outcome === "succeeded") {
      result.succeeded++;
    } else if (receipt.outcome === "skipped") {
      result.skipped++;
    } else {
      result.failed++;
    }
  }

  return result;
}

export type PendingSettlement = {
  merchantId: string;
  /** The merchant's payout address -- a recipient, never a call target. */
  payoutAddress: string;
  amountRaw: string;
  amountDisplay: string;
  orderId: string;
  details?: string;
};

export type ResidualLoan = {
  loanId: string;
  /** Base units the chain still considers outstanding. */
  residualRaw: string;
};

/**
 * Close out loans the chain still considers open for a trailing few units.
 *
 * A plan can finish every instalment and still sit fractionally short. The
 * cause is a rounding disagreement -- the contract's threshold ladder rounds
 * each rung up, so a schedule that rounds any other way banks a small deficit
 * that later instalments cannot recover. `buildInstallments` now follows the
 * contract exactly, but loans opened before that fix still carry it, and any
 * partial collection can leave the same residue.
 *
 * The cost of leaving it is out of all proportion to its size. The loan never
 * reaches `Repaid`, so it stays on the borrower's dashboard, it keeps counting
 * against their credit limit, and `CollateralVault.withdraw` refuses to release
 * their collateral while any debt is outstanding -- indefinitely, over a
 * fraction of a cent.
 *
 * Sweeping is normally a bad trade because gas costs more than the dust is
 * worth. Here gas is sponsored, so it is nearly free, and what it buys is a
 * plan that actually closes.
 */
export async function runCloseOut(opts: {
  keeper: PolarisKeeper;
  residuals: ResidualLoan[];
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<JobResult> {
  const log = opts.log ?? console.log;

  const result: JobResult = {
    job: "close-out",
    considered: opts.residuals.length,
    acted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    receipts: [],
  };

  for (const loan of opts.residuals) {
    if (opts.dryRun) {
      log(`[dry-run] would sweep ${loan.residualRaw} to close loan ${loan.loanId}`);
      result.skipped++;
      continue;
    }

    // Charged as a further attempt on the final instalment, so the idempotency
    // key is fresh and a retry is never served the previous response.
    const receipt = await opts.keeper.collectInstallment({
      loanId: loan.loanId,
      installment: 0,
      amountRaw: loan.residualRaw,
      amountDisplay: `${loan.residualRaw} (close-out)`,
    });
    result.acted++;
    result.receipts.push(receipt);
    log(formatReceipt(receipt));

    if (receipt.outcome === "succeeded") {
      result.succeeded++;
    } else {
      result.failed++;
    }
  }

  return result;
}

/** Pay merchants what they are owed. */
export async function runSettlement(opts: {
  keeper: PolarisKeeper;
  pending: PendingSettlement[];
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<JobResult> {
  const log = opts.log ?? console.log;
  const result: JobResult = {
    job: "settlement",
    considered: opts.pending.length,
    acted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    receipts: [],
  };

  for (const p of opts.pending) {
    if (opts.dryRun) {
      log(`[dry-run] would settle ${p.amountDisplay} to merchant ${p.merchantId}`);
      result.skipped++;
      continue;
    }
    const receipt = await opts.keeper.settleMerchant(p);
    result.acted++;
    result.receipts.push(receipt);
    log(formatReceipt(receipt));
    receipt.outcome === "succeeded" ? result.succeeded++ : result.failed++;
  }

  return result;
}

export function summarize(results: JobResult[]): string {
  return results
    .map(
      (r) =>
        `${r.job}: ${r.considered} considered, ${r.succeeded} succeeded, ${r.failed} failed, ${r.skipped} skipped`
    )
    .join("\n");
}
