/**
 * The shapes the program actually stores, and the arithmetic it actually does.
 *
 * Every number this app renders comes through here rather than being written
 * into a screen, and the schedule math is a direct port of
 * `programs/polaris/src/math.rs` — ceiling division off one canonical ladder,
 * interest annualised and pro-rated over the term.
 *
 * That duplication is deliberate and it is the same call the SDK makes: a
 * checkout has to quote a plan before it sends anything, and a round trip per
 * keystroke is not acceptable. The program recomputes all of it and is the only
 * thing that decides what moves.
 *
 * The state below is a fixture, standing in for the RPC layer until the wallet
 * is wired. Its numbers are real ones — the values the lifecycle script prints
 * against a validator — rather than round figures chosen to look tidy.
 */

export const USDC = 1_000_000;
export const DAY = 86_400;

export type LoanStatus = "active" | "repaid" | "liquidated";
export type SubStatus = "active" | "cancelled" | "lapsed";

export type Loan = {
  id: number;
  merchant: string;
  merchantIcon: string;
  principal: number;
  totalOwed: number;
  totalRepaid: number;
  installmentCount: number;
  installmentsPaid: number;
  startedAt: number;
  intervalSeconds: number;
  status: LoanStatus;
};

export type Plan = {
  id: number;
  merchant: string;
  merchantIcon: string;
  name: string;
  pricePerPeriod: number;
  periodSeconds: number;
  nextChargeAt: number;
  periodsCharged: number;
  missedCharges: number;
  status: SubStatus;
};

export type CreditProfile = {
  score: number;
  onTimePayments: number;
  latePayments: number;
  liquidations: number;
  activeDebt: number;
  lockedCollateral: number;
};

// ---------------------------------------------------------------------------
// Math — ported from math.rs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

const now = Math.floor(Date.now() / 1000);

export const profile: CreditProfile = {
  score: 648,
  onTimePayments: 4,
  latePayments: 0,
  liquidations: 0,
  activeDebt: 302 * USDC + 291_000,
  lockedCollateral: 200 * USDC,
};

export const loans: Loan[] = [
  {
    id: 3,
    merchant: "Kettle & Co",
    merchantIcon: "◈",
    principal: 240 * USDC,
    totalOwed: 240 * USDC + 1_841_000,
    totalRepaid: 60 * USDC + 461_000,
    installmentCount: 4,
    installmentsPaid: 1,
    startedAt: now - 9 * DAY,
    intervalSeconds: 7 * DAY,
    status: "active",
  },
  {
    id: 2,
    merchant: "Northline Audio",
    merchantIcon: "▲",
    principal: 120 * USDC,
    totalOwed: 120 * USDC + 920_000,
    totalRepaid: 60 * USDC + 460_000,
    installmentCount: 4,
    installmentsPaid: 2,
    startedAt: now - 21 * DAY,
    intervalSeconds: 7 * DAY,
    status: "active",
  },
  {
    id: 1,
    merchant: "Ascent Demo Store",
    merchantIcon: "●",
    principal: 400 * USDC,
    totalOwed: 400 * USDC + 304,
    totalRepaid: 400 * USDC + 304,
    installmentCount: 4,
    installmentsPaid: 4,
    startedAt: now - 40 * DAY,
    intervalSeconds: 7 * DAY,
    status: "repaid",
  },
];

export const plans: Plan[] = [
  {
    id: 1,
    merchant: "Meridian",
    merchantIcon: "◇",
    name: "Pro monthly",
    pricePerPeriod: 12 * USDC,
    periodSeconds: 30 * DAY,
    nextChargeAt: now + 6 * DAY,
    periodsCharged: 4,
    missedCharges: 0,
    status: "active",
  },
  {
    id: 2,
    merchant: "Relay Data",
    merchantIcon: "◆",
    name: "Indexer",
    pricePerPeriod: 29 * USDC,
    periodSeconds: 30 * DAY,
    nextChargeAt: now + 19 * DAY,
    periodsCharged: 11,
    missedCharges: 0,
    status: "active",
  },
];

export type ActivityEvent = {
  id: string;
  kind: "collected" | "originated" | "charged" | "settled" | "liquidated" | "score";
  title: string;
  detail: string;
  amount?: number;
  at: number;
  signature: string;
};

export const activity: ActivityEvent[] = [
  {
    id: "a1",
    kind: "collected",
    title: "Installment 2 of 4 collected",
    detail: "Kettle & Co · gas paid by the keeper",
    amount: 60 * USDC + 460_000,
    at: now - 2 * 3_600,
    signature: "42LYLQyyNieAq7vA21WKpCmDU6MEh4xHPXtqHChqh9Ut",
  },
  {
    id: "a2",
    kind: "score",
    title: "Credit score 636 → 648",
    detail: "On-time payment",
    at: now - 2 * 3_600,
    signature: "42LYLQyyNieAq7vA21WKpCmDU6MEh4xHPXtqHChqh9Ut",
  },
  {
    id: "a3",
    kind: "charged",
    title: "Meridian Pro, period 4",
    detail: "Subscription charged on schedule",
    amount: 12 * USDC,
    at: now - 3 * DAY,
    signature: "1269MmpfJak1iACtQV9UKBRBLeUEt3xSGbZMyVCAh34U",
  },
  {
    id: "a4",
    kind: "originated",
    title: "Split 240.00 into 4",
    detail: "Kettle & Co paid in full up front",
    amount: 240 * USDC,
    at: now - 9 * DAY,
    signature: "3PBi2XHLuejSpwdAVx669RJ2TXfvev6mZMUWJAEqGWf1",
  },
  {
    id: "a5",
    kind: "collected",
    title: "Installment 4 of 4 collected",
    detail: "Ascent Demo Store · plan closed",
    amount: 100 * USDC + 76,
    at: now - 12 * DAY,
    signature: "2AUCL6SPFiVqGztXupn9u8pnGrBHnhywAuKkN1KN5n5t",
  },
];

/** The next thing the keeper will do, which is what a borrower actually wants. */
export function nextCollection(): { loan: Loan; amount: number; dueAt: number } | null {
  const active = loans.filter((l) => l.status === "active");
  if (!active.length) return null;
  const withDue = active.map((loan) => ({
    loan,
    amount: installmentAmount(loan),
    dueAt: installmentDueAt(loan, loan.installmentsPaid),
  }));
  withDue.sort((a, b) => a.dueAt - b.dueAt);
  return withDue[0];
}
