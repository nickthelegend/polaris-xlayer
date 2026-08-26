/**
 * Underwriting a borrower nobody has underwritten.
 *
 * The hard problem in undercollateralized credit is the first loan: a new
 * borrower has no repayment history with us, so a flat starting score treats a
 * three-year-old wallet that has serviced an Aave position identically to one
 * funded an hour ago. That is the difference between a credit product and a
 * faucet.
 *
 * Everything here is a public on-chain fact. No bureau, no KYC, no
 * self-attestation — the borrower cannot claim a history they do not have,
 * because we read it ourselves.
 *
 * Signals are deliberately conservative: each contributes a bounded number of
 * points and the total is clamped, so no single signal can carry an approval.
 * A borrower who games one of them still has to pass the others.
 */

export type SignalName =
  | "wallet_age"
  | "transaction_count"
  | "stablecoin_balance"
  | "defi_tenure"
  | "aave_history"
  | "liquidation_history"
  | "funding_concentration";

export type Signal = {
  name: SignalName;
  /** Points contributed. Negative for adverse findings. */
  points: number;
  /** What was observed, in words a borrower could be shown. */
  evidence: string;
  /** Raw value, for auditing a decision after the fact. */
  raw?: string | number;
};

export type UnderwritingResult = {
  address: string;
  /** Where this borrower should start, in the 300-850 band. */
  startingScore: number;
  /** Points before clamping, so a decision can be re-derived. */
  rawPoints: number;
  signals: Signal[];
  /** Set when a signal is disqualifying regardless of the total. */
  declined?: { reason: string };
  assessedAt: string;
};

/** The score a borrower with no signal at all receives. */
export const BASELINE_SCORE = 600;
export const MIN_SCORE = 300;
export const MAX_STARTING_SCORE = 780;

/**
 * Points are capped per signal so the model degrades gracefully when a data
 * source is unavailable: a missing signal contributes zero rather than
 * skewing the result, and the borrower is neither rewarded nor punished for
 * our inability to read something.
 */
export const SIGNAL_CAPS: Record<SignalName, { min: number; max: number }> = {
  wallet_age: { min: -30, max: 60 },
  transaction_count: { min: 0, max: 40 },
  stablecoin_balance: { min: 0, max: 30 },
  defi_tenure: { min: 0, max: 50 },
  aave_history: { min: 0, max: 60 },
  liquidation_history: { min: -150, max: 0 },
  funding_concentration: { min: -80, max: 0 },
};

function clampSignal(name: SignalName, points: number): number {
  const cap = SIGNAL_CAPS[name];
  return Math.max(cap.min, Math.min(cap.max, Math.round(points)));
}

// ---------------------------------------------------------------------
// Individual signals
// ---------------------------------------------------------------------

/**
 * Wallet age. A wallet that has existed through a full market cycle has
 * demonstrated something a two-day-old wallet cannot, and a wallet created
 * minutes ago is the single cheapest thing an attacker can produce.
 */
export function walletAgeSignal(firstSeenMsAgo: number | null): Signal {
  if (firstSeenMsAgo === null) {
    return {
      name: "wallet_age",
      points: 0,
      evidence: "No transaction history found for this address.",
    };
  }
  const days = Math.floor(firstSeenMsAgo / 86_400_000);

  // Under a week is treated as adverse, not merely neutral: a fresh wallet
  // asking for credit is the sybil pattern, and neutrality would make farming
  // free.
  let points: number;
  if (days < 7) points = -30;
  else if (days < 30) points = 0;
  else if (days < 180) points = 20;
  else if (days < 365) points = 40;
  else points = 60;

  return {
    name: "wallet_age",
    points: clampSignal("wallet_age", points),
    evidence:
      days < 7
        ? `Wallet is ${days} day(s) old — too new to have a track record.`
        : `Wallet has been active for ${days} days.`,
    raw: days,
  };
}

/** Sustained usage, not a single funding transaction. */
export function transactionCountSignal(count: number): Signal {
  let points: number;
  if (count < 5) points = 0;
  else if (count < 50) points = 10;
  else if (count < 250) points = 25;
  else points = 40;

  return {
    name: "transaction_count",
    points: clampSignal("transaction_count", points),
    evidence: `${count} transaction(s) sent from this address.`,
    raw: count,
  };
}

/**
 * Held stablecoin balance. Not a proxy for wealth — a proxy for having the
 * means to make the next instalment.
 */
export function stablecoinBalanceSignal(balanceRaw: bigint, decimals = 6): Signal {
  const units = Number(balanceRaw / 10n ** BigInt(decimals));
  let points: number;
  if (units < 10) points = 0;
  else if (units < 100) points = 10;
  else if (units < 1_000) points = 20;
  else points = 30;

  return {
    name: "stablecoin_balance",
    points: clampSignal("stablecoin_balance", points),
    evidence: `Holds ${units} stablecoin unit(s).`,
    raw: units,
  };
}

/**
 * Breadth of DeFi engagement. Someone who has interacted with several lending
 * or DEX protocols has more at stake reputationally than a single-purpose
 * wallet, and more to lose by defaulting.
 */
export function defiTenureSignal(protocolsInteracted: number): Signal {
  const points = Math.min(50, protocolsInteracted * 12);
  return {
    name: "defi_tenure",
    points: clampSignal("defi_tenure", points),
    evidence: `Interacted with ${protocolsInteracted} known DeFi protocol(s).`,
    raw: protocolsInteracted,
  };
}

/**
 * Repayment history on Aave.
 *
 * This is the closest external analogue to what Polaris underwrites: someone
 * who has serviced a variable-rate borrow for months has demonstrated exactly
 * the behaviour we are pricing. A currently-healthy position counts for more
 * than a closed one, because it is ongoing evidence rather than a memory.
 */
export function aaveHistorySignal(params: {
  hasBorrowed: boolean;
  healthFactor: number | null;
  monthsActive: number;
}): Signal {
  if (!params.hasBorrowed) {
    return {
      name: "aave_history",
      points: 0,
      evidence: "No Aave borrow history found.",
    };
  }

  let points = 20 + Math.min(20, params.monthsActive * 3);

  // A health factor near 1 means the position is close to liquidation. That is
  // ongoing evidence of risk appetite, not of reliability.
  if (params.healthFactor !== null) {
    if (params.healthFactor < 1.1) points -= 20;
    else if (params.healthFactor > 2) points += 20;
  }

  return {
    name: "aave_history",
    points: clampSignal("aave_history", points),
    evidence:
      params.healthFactor === null
        ? `Serviced an Aave borrow for ${params.monthsActive} month(s).`
        : `Serviced an Aave borrow for ${params.monthsActive} month(s), current health factor ${params.healthFactor.toFixed(2)}.`,
    raw: params.healthFactor ?? undefined,
  };
}

/**
 * Prior liquidations anywhere.
 *
 * The single most predictive negative signal in lending, and it is public. Two
 * or more is disqualifying on its own: someone liquidated repeatedly is not a
 * pricing problem, they are a different product.
 */
export function liquidationHistorySignal(count: number): Signal {
  const points = count === 0 ? 0 : -Math.min(150, 60 + (count - 1) * 45);
  return {
    name: "liquidation_history",
    points: clampSignal("liquidation_history", points),
    evidence:
      count === 0
        ? "No prior liquidations found."
        : `${count} prior liquidation(s) across lending protocols.`,
    raw: count,
  };
}

/**
 * Above this out-degree a funder is infrastructure — a faucet, an exchange
 * withdrawal address, a bridge — not a person running a sybil farm.
 */
export const INFRASTRUCTURE_OUTDEGREE = 60;

/**
 * Funding concentration — the sybil check.
 *
 * Fifty wallets funded from one address can be one borrower with fifty credit
 * limits. But out-degree alone is the wrong test, and testing it live proved
 * it: a faucet-funded borrower was declined because their faucet had funded
 * hundreds of wallets. That would reject essentially every new user, which is
 * the opposite of what this signal is for.
 *
 * The sybil shape is a funder with a *moderate* cluster of siblings. A funder
 * with thousands of outputs is an exchange, and being paid by an exchange is
 * mildly reassuring rather than suspicious.
 */
export function fundingConcentrationSignal(params: {
  siblingWalletsFromSameFunder: number;
  /** True when the funder is a known faucet, exchange or bridge. */
  funderIsInfrastructure?: boolean;
}): Signal {
  const n = params.siblingWalletsFromSameFunder;
  const infra = params.funderIsInfrastructure || n >= INFRASTRUCTURE_OUTDEGREE;

  if (infra) {
    return {
      name: "funding_concentration",
      points: 0,
      evidence:
        "Funded from a shared source such as a faucet, exchange or bridge — normal, not a cluster.",
      raw: 0,
    };
  }

  let points = 0;
  if (n >= 25) points = -80;
  else if (n >= 12) points = -50;
  else if (n >= 6) points = -20;

  return {
    name: "funding_concentration",
    points: clampSignal("funding_concentration", points),
    evidence:
      n < 6
        ? "Funding source is not shared with a cluster of other wallets."
        : `Funding source also funded ${n} other wallets and is not known infrastructure — possible sybil cluster.`,
    raw: n,
  };
}

// ---------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------

/**
 * Combine signals into a starting score.
 *
 * Capped below the top of the band: chain history can earn a borrower a strong
 * start, but the highest limits should be reachable only by repaying us. An
 * imported reputation is evidence; a repaid instalment is proof.
 */
export function scoreFromSignals(address: string, signals: Signal[]): UnderwritingResult {
  const rawPoints = signals.reduce((sum, s) => sum + s.points, 0);

  const liquidations = signals.find((s) => s.name === "liquidation_history");
  const sybil = signals.find((s) => s.name === "funding_concentration");

  let declined: UnderwritingResult["declined"];
  if (typeof liquidations?.raw === "number" && liquidations.raw >= 2) {
    declined = { reason: "Two or more prior liquidations across lending protocols." };
  } else if (typeof sybil?.raw === "number" && sybil.raw >= 25) {
    declined = { reason: "Funding pattern indicates a sybil cluster." };
  }

  const startingScore = Math.max(
    MIN_SCORE,
    Math.min(MAX_STARTING_SCORE, BASELINE_SCORE + rawPoints)
  );

  return {
    address,
    startingScore,
    rawPoints,
    signals,
    declined,
    assessedAt: new Date().toISOString(),
  };
}

/** Borrower-facing explanation of a decision. */
export function explain(result: UnderwritingResult): string {
  const lines = [
    result.declined
      ? `Declined: ${result.declined.reason}`
      : `Starting score ${result.startingScore}, based on your on-chain history:`,
    "",
  ];
  for (const s of [...result.signals].sort((a, b) => b.points - a.points)) {
    const sign = s.points > 0 ? `+${s.points}` : `${s.points}`;
    lines.push(`  ${sign.padStart(5)}  ${s.evidence}`);
  }
  if (!result.declined) {
    lines.push("", "Repaying instalments on time raises this further.");
  }
  return lines.join("\n");
}
