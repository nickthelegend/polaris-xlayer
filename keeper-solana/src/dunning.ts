/**
 * Dunning — what happens when a charge does not land.
 *
 * Transport-level retries solve "the transaction did not get confirmed". They
 * do nothing for "the borrower did not have the money", which is the failure
 * that actually dominates a credit book. That one needs a business schedule
 * measured in days, plus a point at which the loan stops being a collection
 * problem and becomes a liquidation.
 *
 * Retrying an insufficient-funds failure on a network schedule is worse than
 * useless: it burns rate limit, produces a wall of identical failures in the
 * audit trail, and delays the escalation that would actually recover the money.
 *
 * This module is deliberately pure. It moves no tokens, reads no chain, and
 * takes `now` as an argument, so the ladder is testable without a validator.
 */

import type { FailureKind } from "./errors.ts";

export type DunningStage = {
  /** Attempt number this stage governs (1-based). */
  attempt: number;
  /** Wait from the previous failure before retrying. */
  delayHours: number;
  /** Tell the borrower at this stage. */
  notify: boolean;
  label: string;
};

/**
 * Retry soon in case it was a momentary shortfall, then back off over a week,
 * then stop. Tuned to be recognisable to anyone who has run a card book — the
 * shape matters more than the exact hours, and it is overridable per merchant.
 */
export const DEFAULT_LADDER: readonly DunningStage[] = [
  { attempt: 1, delayHours: 0, notify: false, label: "initial" },
  { attempt: 2, delayHours: 6, notify: true, label: "soft-retry" },
  { attempt: 3, delayHours: 24, notify: true, label: "day-1" },
  { attempt: 4, delayHours: 72, notify: true, label: "day-3" },
  { attempt: 5, delayHours: 168, notify: true, label: "final-notice" },
];

/**
 * A lost delegation is not a money problem and does not belong on the money
 * ladder. The borrower has to take one action — re-approve — and until they do,
 * every retry fails identically. So: tell them promptly, twice, then stop
 * chasing and let the loan age into liquidation on its own schedule.
 */
export const DELEGATION_LADDER: readonly DunningStage[] = [
  { attempt: 1, delayHours: 1, notify: true, label: "reauthorize" },
  { attempt: 2, delayHours: 48, notify: true, label: "reauthorize-final" },
];

export type DunningDecision =
  | { action: "retry"; at: Date; stage: DunningStage; notify: boolean; message?: string }
  | { action: "escalate"; reason: string }
  | { action: "abandon"; reason: string; notify: false };

export type DunningInput = {
  /** Attempts already made, including the one that just failed. */
  attemptsMade: number;
  failureKind: FailureKind;
  /** The classifier's own detail, when it had one. `would_revert` is also the
   *  catch-all, so without this an unrecognised error is announced as a
   *  confident diagnosis of a state the keeper never actually read. */
  detail?: string;
  /** Injected so this stays deterministic in tests. */
  now: Date;
  ladder?: readonly DunningStage[];
};

export function nextDunningStep(input: DunningInput): DunningDecision {
  switch (input.failureKind) {
    case "operator":
      return {
        action: "abandon",
        notify: false,
        reason:
          "Operator-side failure — keeper wallet, RPC or configuration. Fix it and requeue. The borrower did nothing wrong and must not hear about it.",
      };

    case "would_revert":
      return {
        action: "abandon",
        notify: false,
        /*
         * `would_revert` is both a real classification and the classifier's
         * fallback. Claiming "the program rejected this on current state" for
         * an error nobody classified is a diagnosis the keeper has not earned —
         * it sent an operator chasing a loan whose guards all passed. When the
         * classifier had no specific code, say so and show what actually came
         * back.
         */
        reason: input.detail
          ? `Unclassified failure — not necessarily a program rejection. Raw: ${input.detail}`
          : "The program rejected the call on current state — the loan may be closed, already collected, or not yet due. Needs reconciliation, not a retry.",
      };

    case "indefinite":
      // Sent, outcome unknown. Re-checking the signature is the job, not
      // sending again.
      return {
        action: "retry",
        at: new Date(input.now.getTime() + 60_000),
        stage: { attempt: input.attemptsMade, delayHours: 0, notify: false, label: "reconcile" },
        notify: false,
        message: "Outcome unknown. Re-check the signature before sending anything else.",
      };

    case "delegation_lost":
    case "delegation_exhausted": {
      const ladder = input.ladder ?? DELEGATION_LADDER;
      const next = ladder.find((s) => s.attempt === input.attemptsMade + 1);
      if (!next) {
        return {
          action: "escalate",
          reason:
            "The borrower did not restore the delegation. Nothing can be collected; the loan is a liquidation candidate once grace elapses.",
        };
      }
      return { action: "retry", at: at(input.now, next), stage: next, notify: next.notify };
    }

    case "insufficient_funds":
    case "transient":
    default: {
      const ladder = input.ladder ?? DEFAULT_LADDER;
      const next = ladder.find((s) => s.attempt === input.attemptsMade + 1);
      if (!next) {
        return {
          action: "escalate",
          reason: `Ladder exhausted after ${input.attemptsMade} attempts; the loan is a liquidation candidate.`,
        };
      }
      return { action: "retry", at: at(input.now, next), stage: next, notify: next.notify };
    }
  }
}

function at(now: Date, stage: DunningStage): Date {
  return new Date(now.getTime() + stage.delayHours * 3_600_000);
}

/**
 * Decide whether to collect a smaller amount when the borrower is short.
 *
 * A borrower holding 38 of a 50 installment is not a default — taking the 38
 * now reduces exposure, keeps the plan moving, and leaves a smaller shortfall
 * to chase. Taking nothing is strictly worse for both sides.
 *
 * Guarded by a floor, because collecting dust costs more in fees than it
 * recovers and a stream of 0.30 charges reads to a borrower like a malfunction.
 *
 * Note this is advice the *keeper* acts on by calling the borrower-signed
 * repayment path, not something the permissionless instruction can do: that one
 * takes no amount by design.
 */
export type PartialDecision =
  | { action: "collect-partial"; amount: bigint; shortfall: bigint }
  | { action: "skip"; reason: string };

export function partialCollection(params: {
  /** Installment due, in base units. */
  due: bigint;
  /** What the borrower can actually cover right now, in base units. */
  available: bigint;
  /** Below this, collecting is not worth the fee. Default 1 USDC. */
  floor?: bigint;
}): PartialDecision {
  const floor = params.floor ?? 1_000_000n;
  if (params.available >= params.due) {
    return { action: "skip", reason: "Nothing is short; collect the full installment." };
  }
  if (params.available < floor) {
    return {
      action: "skip",
      reason: `Available ${params.available} is below the ${floor} floor; not worth the fee.`,
    };
  }
  return {
    action: "collect-partial",
    amount: params.available,
    shortfall: params.due - params.available,
  };
}

/** What the borrower should be told, if anything. */
export function dunningMessage(kind: FailureKind, stage: DunningStage, amount: string): string {
  switch (kind) {
    case "delegation_lost":
      return `We could not collect your ${amount} installment because the payment authorization on your account was removed. Re-authorize Polaris to keep the plan on track.`;
    case "delegation_exhausted":
      return `Your payment authorization no longer covers the remaining ${amount}. Increase it to keep the plan on track.`;
    case "insufficient_funds":
      return stage.label === "final-notice"
        ? `Final notice: we have been unable to collect your ${amount} installment. Please top up to avoid your plan being closed and your credit score affected.`
        : `We could not collect your ${amount} installment — your balance was short. We will try again.`;
    default:
      return `We could not collect your ${amount} installment. We will try again.`;
  }
}
