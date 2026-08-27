/**
 * What changed between two reads of the same borrower.
 *
 * Its own module, with no chain imports, so `mobile/test` can execute it in
 * plain Node. The shapes below are structural on purpose — the differ needs
 * five fields and should not drag `@solana/web3.js` in behind them.
 */

export type ProfileShape = {
  score: number;
  activeDebt: number;
  lockedCollateral: number;
};

export type LoanShape = {
  address: string;
  status: string;
  totalRepaid: number;
  totalOwed: number;
};

/**
 * What moved, when the chain told us rather than the user asking.
 *
 * A live update that silently rewrites two numbers is easy to miss — and the
 * whole point of watching the account is that the borrower sees their position
 * change without doing anything. This is the diff, in their words.
 */
export type LiveChange = {
  title: string;
  detail: string;
  amount: number | null;
  at: number;
};

/**
 * Name what changed between two reads of the same borrower.
 *
 * Derived from the accounts themselves rather than from an event log, because
 * the socket says only "this account moved" — the app already holds the
 * previous values, and the difference between them is the fact worth showing.
 *
 * Returns null when nothing a borrower would care about moved, so a write that
 * only touched a bump or a counter does not raise a banner.
 */
export function describeChange(
  before: { profile: ProfileShape | null; loans: LoanShape[] } | null,
  profile: ProfileShape | null,
  loans: LoanShape[],
  now: number,
): LiveChange | null {
  if (!before?.profile || !profile) return null;
  const at = now;

  const collected = loans.reduce((sum, loan) => {
    const was = before.loans.find((l) => l.address === loan.address);
    return sum + (was ? Math.max(0, loan.totalRepaid - was.totalRepaid) : 0);
  }, 0);

  const settled = loans.find((loan) => {
    const was = before.loans.find((l) => l.address === loan.address);
    return was && was.status === "active" && loan.status === "repaid";
  });

  if (settled) {
    return {
      title: "Plan paid off",
      detail: "Every installment collected. Nothing further is owed on it.",
      amount: settled.totalOwed,
      at,
    };
  }

  if (collected > 0) {
    return {
      title: "Installment collected",
      detail: "The keeper charged this. You did not have to be online.",
      amount: collected,
      at,
    };
  }

  if (profile.score !== before.profile.score) {
    const up = profile.score > before.profile.score;
    return {
      title: `Credit score ${before.profile.score} → ${profile.score}`,
      detail: up ? "Paying on time raised it." : "A missed payment cost you this.",
      amount: null,
      at,
    };
  }

  if (profile.lockedCollateral !== before.profile.lockedCollateral) {
    const up = profile.lockedCollateral > before.profile.lockedCollateral;
    return {
      title: up ? "Collateral locked" : "Collateral returned",
      detail: up ? "Your limit has gone up." : "Your limit is back to what your score earns.",
      amount: Math.abs(profile.lockedCollateral - before.profile.lockedCollateral),
      at,
    };
  }

  if (profile.activeDebt !== before.profile.activeDebt) {
    const up = profile.activeDebt > before.profile.activeDebt;
    return {
      title: up ? "New plan opened" : "Debt reduced",
      detail: up ? "The merchant has been paid in full." : "That is off your balance.",
      amount: Math.abs(profile.activeDebt - before.profile.activeDebt),
      at,
    };
  }

  return null;
}
