import type { Evidence } from "./evidence.ts";

/**
 * The same weights the program applies, mirrored so a borrower can be shown
 * what their line will be before it is opened.
 *
 * A mirror of on-chain arithmetic is a liability the moment the two drift, so
 * this is not trusted anywhere: the program computes the score that counts, and
 * `test/underwrite.test.ts` opens a real line against a real validator and
 * asserts the chain agreed with this function. If someone changes a weight in
 * `constants.rs` and not here, that test fails.
 */
export const WEIGHTS = {
  floor: 520,
  agePointsPerMonth: 2,
  maxAgePoints: 60,
  activityPointsPer25Tx: 1,
  maxActivityPoints: 50,
  breadthPointsPerAccount: 2,
  maxBreadthPoints: 40,
  balancePointsPer100: 1,
  maxBalancePoints: 50,
  minScore: 300,
  maxScore: 850,
} as const;

export type Band = {
  score: number;
  limit: bigint;
  breakdown: { age: number; activity: number; breadth: number; balance: number };
};

export function scoreFrom(e: Evidence): Band {
  const age = Math.min(
    Math.floor(e.walletAgeDays / 30) * WEIGHTS.agePointsPerMonth,
    WEIGHTS.maxAgePoints
  );
  const activity = Math.min(
    Math.floor(e.transactionCount / 25) * WEIGHTS.activityPointsPer25Tx,
    WEIGHTS.maxActivityPoints
  );
  const breadth = Math.min(
    e.tokenAccounts * WEIGHTS.breadthPointsPerAccount,
    WEIGHTS.maxBreadthPoints
  );
  const balance = Math.min(
    Number(e.stableBalance / 100_000_000n) * WEIGHTS.balancePointsPer100,
    WEIGHTS.maxBalancePoints
  );

  const score = Math.min(
    Math.max(WEIGHTS.floor + age + activity + breadth + balance, WEIGHTS.minScore),
    WEIGHTS.maxScore
  );

  return { score, limit: baseLimit(score), breakdown: { age, activity, breadth, balance } };
}

/** The piecewise bands from `CreditProfile::base_limit`, in base units. */
export function baseLimit(score: number): bigint {
  if (score >= 800) return 5_000_000_000n;
  if (score >= 740) return 2_500_000_000n;
  if (score >= 670) return 1_000_000_000n;
  if (score >= 580) return 500_000_000n;
  return 200_000_000n;
}

/**
 * Why the line is what it is, in the borrower's words rather than the model's.
 *
 * A credit decision a borrower cannot interrogate is the thing everyone hates
 * about credit scoring, and here there is no reason for it: every input is
 * public, so the reasons can be too.
 */
export function explain(e: Evidence, band: Band): string[] {
  const lines: string[] = [];
  const { age, activity, breadth, balance } = band.breakdown;

  lines.push(
    e.walletAgeDays >= 30
      ? `Wallet first used ${humanAge(e.walletAgeDays)} ago · +${age}`
      : `Wallet is less than a month old · +${age}`
  );
  lines.push(
    `${e.transactionCountTruncated ? "Over " : ""}${e.transactionCount.toLocaleString()} transactions signed · +${activity}`
  );
  lines.push(
    e.tokenAccounts === 0
      ? `No tokens held · +${breadth}`
      : `${e.tokenAccounts} token${e.tokenAccounts === 1 ? "" : "s"} held · +${breadth}`
  );
  lines.push(`${formatUnits(e.stableBalance)} USDC on hand · +${balance}`);
  return lines;
}

function humanAge(days: number): string {
  if (days >= 365) {
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"}`;
}

export function formatUnits(raw: bigint, decimals = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, "0").slice(0, 2);
  return `${whole.toLocaleString()}.${frac}`;
}
