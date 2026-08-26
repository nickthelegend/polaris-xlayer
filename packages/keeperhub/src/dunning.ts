/**
 * Dunning -- what happens when a charge does not land.
 *
 * Network-level retries (KeeperHub already does 3, with an escalating gas bump)
 * solve "the transaction did not get mined". They do nothing for "the borrower
 * did not have the money", which is the failure that actually dominates a
 * credit book. That one needs a business schedule measured in days, plus a
 * point at which the loan stops being a collection problem and becomes a
 * liquidation.
 *
 * Retrying an insufficient-funds revert on a network schedule is worse than
 * useless: it burns rate limit, produces a wall of identical failures in the
 * audit trail, and delays the escalation that would actually recover the money.
 */

import type { KeeperHubErrorKind } from "./errors.js";

export type DunningStage = {
  /** Attempt number this stage governs (1-based). */
  attempt: number;
  /** Wait from the previous failure before retrying. */
  delayHours: number;
  /** Notify the borrower at this stage. */
  notify: boolean;
  label: string;
};

/**
 * Default ladder: retry soon in case it was a momentary shortfall, then back
 * off over a week, then stop. Tuned to be recognisable to anyone who has run a
 * card book -- the shape matters more than the exact hours, and it is
 * overridable per merchant.
 */
export const DEFAULT_DUNNING_LADDER: readonly DunningStage[] = [
  { attempt: 1, delayHours: 0, notify: false, label: "initial" },
  { attempt: 2, delayHours: 6, notify: true, label: "soft-retry" },
  { attempt: 3, delayHours: 24, notify: true, label: "day-1" },
  { attempt: 4, delayHours: 72, notify: true, label: "day-3" },
  { attempt: 5, delayHours: 168, notify: true, label: "final-notice" },
];

export type DunningDecision =
  | { action: "retry"; at: Date; stage: DunningStage }
  | { action: "escalate"; reason: string }
  | { action: "abandon"; reason: string };

export type DunningInput = {
  /** Attempts already made, including the one that just failed. */
  attemptsMade: number;
  failureKind: KeeperHubErrorKind;
  /** When the failure happened. Injected so this stays deterministic in tests. */
  now: Date;
  ladder?: readonly DunningStage[];
};

/**
 * Decide what to do with a failed installment.
 *
 * The failure kind drives the branch, not just the attempt count:
 *
 *   insufficient_funds -> the borrower is short. Wait on the business ladder.
 *   would_revert       -> protocol state rejects the call (already repaid,
 *                         wrong amount, loan closed). Retrying will not fix it;
 *                         a human or a reconciliation pass has to look.
 *   auth / spend_cap   -> our problem, not theirs. Never dun a customer for it.
 *   rate_limit/timeout/server -> transient; the client already retried, so a
 *                         short business retry is still worthwhile.
 */
export function nextDunningStep(input: DunningInput): DunningDecision {
  const ladder = input.ladder ?? DEFAULT_DUNNING_LADDER;

  if (input.failureKind === "auth" || input.failureKind === "spend_cap") {
    return {
      action: "abandon",
      reason:
        "Operator-side failure (credentials or spend cap). Fix configuration and requeue; do not notify the borrower.",
    };
  }

  if (input.failureKind === "would_revert") {
    return {
      action: "abandon",
      reason:
        "Protocol rejected the repayment on current state (loan may be closed, already repaid, or the amount is stale). Needs reconciliation, not a retry.",
    };
  }

  const next = ladder.find((s) => s.attempt === input.attemptsMade + 1);
  if (!next) {
    return {
      action: "escalate",
      reason: `Dunning ladder exhausted after ${input.attemptsMade} attempts; loan is a liquidation candidate.`,
    };
  }

  return {
    action: "retry",
    at: new Date(input.now.getTime() + next.delayHours * 3_600_000),
    stage: next,
  };
}

/**
 * Decide whether to collect a smaller amount when the borrower is short.
 *
 * A borrower with 38 of a 50 instalment is not a default -- taking the 38 now
 * reduces exposure, keeps the plan moving, and leaves a smaller shortfall to
 * chase. Taking nothing is strictly worse for both sides.
 *
 * Guarded by a floor: collecting dust costs more in gas than it recovers, and
 * a stream of 0.30 charges reads to a borrower like a malfunction.
 */
export type PartialDecision =
  | { action: "collect-partial"; amountRaw: string; shortfallRaw: string }
  | { action: "skip"; reason: string };

export function partialCollection(params: {
  /** Instalment due, in base units. */
  dueRaw: bigint;
  /** What the borrower can actually cover right now, in base units. */
  availableRaw: bigint;
  /** Smallest worthwhile charge. Defaults to 20% of the instalment. */
  floorRaw?: bigint;
}): PartialDecision {
  const floor = params.floorRaw ?? params.dueRaw / 5n;

  if (params.availableRaw >= params.dueRaw) {
    return { action: "skip", reason: "full amount is available; collect normally" };
  }
  if (params.availableRaw <= 0n) {
    return { action: "skip", reason: "nothing to collect" };
  }
  if (params.availableRaw < floor) {
    return {
      action: "skip",
      reason: `available ${params.availableRaw} is below the ${floor} floor; not worth the gas`,
    };
  }
  return {
    action: "collect-partial",
    amountRaw: params.availableRaw.toString(),
    shortfallRaw: (params.dueRaw - params.availableRaw).toString(),
  };
}

/**
 * A borrower who has just topped up should not wait out the back-off.
 *
 * Self-cure clears `nextAttemptAt` so the next keeper pass picks the
 * instalment up, but deliberately does not reset the attempt counter: the
 * misses still happened, and wiping them would let a borrower cycle
 * indefinitely without ever reaching escalation.
 */
export function selfCure(input: {
  attemptsMade: number;
  ladder?: readonly DunningStage[];
}): { allowed: boolean; reason?: string; attemptsMade: number } {
  const ladder = input.ladder ?? DEFAULT_DUNNING_LADDER;
  const exhausted = input.attemptsMade >= ladder.length;
  if (exhausted) {
    return {
      allowed: false,
      reason: "Dunning ladder is exhausted; this loan is a liquidation candidate.",
      attemptsMade: input.attemptsMade,
    };
  }
  return { allowed: true, attemptsMade: input.attemptsMade };
}

/** Borrower-facing copy for a dunning stage. Plain, not threatening. */
export function dunningMessage(
  stage: DunningStage,
  ctx: { amount: string; loanId: string }
): string {
  switch (stage.label) {
    case "soft-retry":
      return `We could not collect your ${ctx.amount} installment for loan ${ctx.loanId}. We will try again in ${stage.delayHours} hours -- topping up your wallet before then is all that is needed.`;
    case "day-1":
    case "day-3":
      return `Your ${ctx.amount} installment on loan ${ctx.loanId} is still outstanding. We will retry automatically; repeated misses affect your Polaris credit score.`;
    case "final-notice":
      return `Final notice: the ${ctx.amount} installment on loan ${ctx.loanId} remains unpaid. If this attempt fails the loan becomes eligible for liquidation.`;
    default:
      return `Installment of ${ctx.amount} on loan ${ctx.loanId} could not be collected.`;
  }
}
