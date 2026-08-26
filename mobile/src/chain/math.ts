/**
 * Schedule and credit arithmetic, ported from `programs/polaris/src/math.rs`.
 *
 * Duplicated from the program on purpose, and it is the same call the SDK
 * makes: a checkout has to quote a plan before it sends anything, and a round
 * trip per keystroke is not acceptable. The program recomputes every number and
 * is the only thing that decides what moves — this exists so the borrower sees
 * the same figures a moment earlier.
 *
 * There is deliberately no state in this file. It used to sit alongside a set
 * of fixtures, and the fixtures are gone: every number the app renders now
 * comes from `queries.ts`, off the chain.
 */
import type { CreditProfile, Loan } from "./queries";

export const USDC = 1_000_000;
export const DAY = 86_400;


const INTEREST_RATE_BPS = 1_000; // 10% annualised
const SECONDS_PER_YEAR = 365 * DAY;

/** Annualised and pro-rated. A 30-day plan must not cost what a 365-day one does. */
export function interestFor(principal: number, termSeconds: number): number {
  return Math.floor(
    (principal * INTEREST_RATE_BPS * termSeconds) / (10_000 * SECONDS_PER_YEAR),
  );
}

/**
 * Cumulative amount owed for `k` installments to count as complete.
 *
 * Rounded **up**, and the schedule and the progress check both read from this
 * one function. Rounding the quote down and inferring progress down again is
 * how a full payment lands a base unit short of its own threshold and counts as
 * unpaid — a bug the Solidity build shipped once and has a regression test for.
 */
export function thresholdFor(totalOwed: number, count: number, k: number): number {
  if (k <= 0) return 0;
  if (k >= count || count === 0) return totalOwed;
  return Math.ceil((totalOwed * k) / count);
}

export function installmentAmount(loan: Loan): number {
  if (loan.installmentsPaid >= loan.installmentCount) return 0;
  const target = thresholdFor(
    loan.totalOwed,
    loan.installmentCount,
    loan.installmentsPaid + 1,
  );
  return Math.max(0, target - loan.totalRepaid);
}

export function installmentDueAt(loan: Loan, index: number): number {
  return loan.startedAt + (index + 1) * loan.intervalSeconds;
}

export function outstanding(loan: Loan): number {
  return Math.max(0, loan.totalOwed - loan.totalRepaid);
}

/**
 * The piecewise credit ladder.
 *
 * Piecewise rather than linear so the jumps are legible — "get to 670 and your
 * limit doubles" is something a borrower can act on; a smooth curve is not.
 */
export function baseLimitForScore(score: number): number {
  if (score >= 800) return 5_000 * USDC;
  if (score >= 740) return 2_500 * USDC;
  if (score >= 670) return 1_000 * USDC;
  if (score >= 580) return 500 * USDC;
  return 200 * USDC;
}

/** What the next band is worth, so the UI can show what the next tier buys. */
export function nextBand(score: number): { at: number; limit: number } | null {
  const bands = [580, 670, 740, 800];
  const next = bands.find((b) => score < b);
  return next ? { at: next, limit: baseLimitForScore(next) } : null;
}

export function creditLine(profile: CreditProfile, multiplierBps = 15_000) {
  const base = baseLimitForScore(profile.score);
  const boost = Math.floor((profile.lockedCollateral * multiplierBps) / 10_000);
  const limit = base + boost;
  return {
    base,
    boost,
    limit,
    activeDebt: profile.activeDebt,
    available: Math.max(0, limit - profile.activeDebt),
  };
}

/** The schedule a borrower sees before committing. */
export function quote(principal: number, count: number, intervalSeconds: number) {
  const interest = interestFor(principal, count * intervalSeconds);
  const totalOwed = principal + interest;
  const now = Math.floor(Date.now() / 1000);
  const schedule = Array.from({ length: count }, (_, i) => ({
    index: i,
    dueAt: now + (i + 1) * intervalSeconds,
    amount:
      thresholdFor(totalOwed, count, i + 1) - thresholdFor(totalOwed, count, i),
  }));
  return { principal, interest, totalOwed, schedule };
}

/**
 * Pluralise a count.
 *
 * Small, but "1 periods charged" is the kind of thing that makes an otherwise
 * careful interface look unfinished — and it is always a real count from the
 * chain, so it will hit 1 for every borrower on their first period.
 */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
