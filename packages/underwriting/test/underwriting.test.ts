/**
 * The model has to be defensible: a borrower is entitled to know why they were
 * scored as they were, and an attacker must not be able to reach approval by
 * maximising one cheap signal. These tests pin both properties.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BASELINE_SCORE,
  MAX_STARTING_SCORE,
  MIN_SCORE,
  aaveHistorySignal,
  collectSignals,
  defiTenureSignal,
  explain,
  fundingConcentrationSignal,
  liquidationHistorySignal,
  scoreFromSignals,
  stablecoinBalanceSignal,
  transactionCountSignal,
  walletAgeSignal,
} from "../dist/index.js";

const DAY = 86_400_000;

describe("wallet age", () => {
  it("treats a days-old wallet as adverse, not merely neutral", () => {
    // Neutrality would make sybil farming free.
    assert.ok(walletAgeSignal(2 * DAY).points < 0);
  });

  it("rewards a wallet that has survived a market cycle", () => {
    assert.ok(walletAgeSignal(400 * DAY).points > walletAgeSignal(60 * DAY).points);
  });

  it("contributes nothing when history is unreadable", () => {
    assert.equal(walletAgeSignal(null).points, 0);
  });
});

describe("liquidation history", () => {
  it("is the heaviest single negative", () => {
    assert.ok(liquidationHistorySignal(1).points <= -60);
  });

  it("gets worse with each additional liquidation", () => {
    assert.ok(liquidationHistorySignal(3).points < liquidationHistorySignal(1).points);
  });

  it("declines outright at two or more, regardless of everything else", () => {
    const result = scoreFromSignals("0xabc", [
      walletAgeSignal(1000 * DAY),
      transactionCountSignal(5000),
      stablecoinBalanceSignal(10_000_000_000n),
      defiTenureSignal(5),
      aaveHistorySignal({ hasBorrowed: true, healthFactor: 3, monthsActive: 24 }),
      liquidationHistorySignal(2),
      fundingConcentrationSignal({ siblingWalletsFromSameFunder: 0 }),
    ]);
    assert.ok(result.declined, "a repeat-liquidated borrower is a different product");
    assert.match(result.declined!.reason, /liquidation/i);
  });
});

describe("sybil resistance", () => {
  it("penalises a wallet funded alongside a cluster", () => {
    assert.ok(
      fundingConcentrationSignal({ siblingWalletsFromSameFunder: 10 }).points <
        fundingConcentrationSignal({ siblingWalletsFromSameFunder: 2 }).points
    );
  });

  it("declines an obvious cluster", () => {
    const r = scoreFromSignals("0xabc", [
      fundingConcentrationSignal({ siblingWalletsFromSameFunder: 25 }),
    ]);
    assert.ok(r.declined);
    assert.match(r.declined!.reason, /sybil/i);
  });

  it("does not punish a normally-funded wallet", () => {
    assert.equal(fundingConcentrationSignal({ siblingWalletsFromSameFunder: 1 }).points, 0);
  });
});

describe("Aave repayment history", () => {
  it("credits a serviced borrow", () => {
    assert.ok(
      aaveHistorySignal({ hasBorrowed: true, healthFactor: 2.5, monthsActive: 6 }).points > 0
    );
  });

  it("discounts a position sitting near liquidation", () => {
    const risky = aaveHistorySignal({ hasBorrowed: true, healthFactor: 1.02, monthsActive: 6 });
    const safe = aaveHistorySignal({ hasBorrowed: true, healthFactor: 2.5, monthsActive: 6 });
    assert.ok(risky.points < safe.points, "risk appetite is not reliability");
  });

  it("contributes nothing when the borrower has never borrowed", () => {
    assert.equal(
      aaveHistorySignal({ hasBorrowed: false, healthFactor: null, monthsActive: 0 }).points,
      0
    );
  });
});

describe("scoring", () => {
  it("returns the baseline when nothing is known", () => {
    assert.equal(scoreFromSignals("0xabc", []).startingScore, BASELINE_SCORE);
  });

  it("caps the best possible start below the top of the band", () => {
    const perfect = scoreFromSignals("0xabc", [
      walletAgeSignal(2000 * DAY),
      transactionCountSignal(100_000),
      stablecoinBalanceSignal(999_999_000_000n),
      defiTenureSignal(20),
      aaveHistorySignal({ hasBorrowed: true, healthFactor: 5, monthsActive: 60 }),
      liquidationHistorySignal(0),
      fundingConcentrationSignal({ siblingWalletsFromSameFunder: 0 }),
    ]);
    assert.ok(
      perfect.startingScore <= MAX_STARTING_SCORE,
      "the highest limits must be earned by repaying us, not imported"
    );
  });

  it("never falls below the floor", () => {
    const worst = scoreFromSignals("0xabc", [
      walletAgeSignal(0),
      liquidationHistorySignal(5),
      fundingConcentrationSignal({ siblingWalletsFromSameFunder: 50 }),
    ]);
    assert.ok(worst.startingScore >= MIN_SCORE);
  });

  it("no single signal can carry an approval on its own", () => {
    // Every cap is bounded, so maximising one still lands near the baseline.
    const onlyAge = scoreFromSignals("0xabc", [walletAgeSignal(3000 * DAY)]);
    assert.ok(
      onlyAge.startingScore - BASELINE_SCORE <= 60,
      "one maximised signal must not be enough"
    );
  });

  it("a good history genuinely beats a blank one", () => {
    const good = scoreFromSignals("0xa", [
      walletAgeSignal(500 * DAY),
      transactionCountSignal(300),
      aaveHistorySignal({ hasBorrowed: true, healthFactor: 2.4, monthsActive: 8 }),
    ]);
    assert.ok(good.startingScore > BASELINE_SCORE + 60);
  });
});

describe("explainability", () => {
  it("shows the borrower every signal that moved their score", () => {
    const r = scoreFromSignals("0xabc", [
      walletAgeSignal(400 * DAY),
      liquidationHistorySignal(1),
    ]);
    const text = explain(r);
    assert.match(text, /Wallet has been active/);
    assert.match(text, /prior liquidation/);
    assert.match(text, /Repaying instalments on time/);
  });

  it("states the reason when declining", () => {
    const r = scoreFromSignals("0xabc", [liquidationHistorySignal(3)]);
    assert.match(explain(r), /^Declined:/);
  });
});

describe("resilience", () => {
  it("degrades to the baseline rather than failing when every source is down", async () => {
    const result = await collectSignals("0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67", {
      rpcUrl: "http://127.0.0.1:1/dead",
      chainId: 11_155_111,
    });
    // A borrower must never be declined because our data source blinked.
    assert.equal(result.startingScore, BASELINE_SCORE);
    assert.equal(result.declined, undefined);
    assert.ok(result.signals.every((s) => s.points === 0));
  });
});
