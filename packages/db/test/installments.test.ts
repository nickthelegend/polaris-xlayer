/**
 * The instalment ladder, in the terms the money is actually in.
 *
 * Every rung has to agree with PolarisLoanEngine to the wei. The chain is the
 * authority on when an instalment counts as earned, and it decides that by
 * comparing totalRepaid against a ceiling-rounded threshold. A book that
 * schedules charges on any other ladder collects an amount the chain does not
 * recognise as completing anything -- which is how a two-wei shortfall once
 * left a fully-paid loan sitting at three of four instalments earned, with its
 * collateral locked and nothing left to collect against it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildInstallments, repaidAfterCollecting } from "../dist/index.js";

/**
 * PolarisLoanEngine.thresholdFor, restated. An independent copy on purpose: if
 * the book's ladder is ever "simplified" these tests have to fail rather than
 * quietly follow it, which they cannot do if they import the same function.
 */
function thresholdFor(totalOwed: bigint, k: number, count: number): bigint {
  if (k <= 0) return 0n;
  if (k >= count) return totalOwed;
  const n = BigInt(count);
  return (totalOwed * BigInt(k) + n - 1n) / n;
}

/** PolarisLoanEngine.installmentsEarned: how many the chain would count. */
function installmentsEarned(totalOwed: bigint, repaid: bigint, count: number): number {
  let k = 0;
  while (k < count && repaid >= thresholdFor(totalOwed, k + 1, count)) k++;
  return k;
}

const START = new Date("2026-08-06T00:00:00Z");
const WEEK = 604_800;

const schedule = (totalOwedRaw: bigint, count: number) =>
  buildInstallments({ totalOwedRaw, count, intervalSeconds: WEEK, startAt: START });

const amounts = (totalOwedRaw: bigint, count: number) =>
  schedule(totalOwedRaw, count).map((i) => BigInt(i.amountRaw));

const total = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

/** The contract rejects anything outside this range at origination. */
const LEGAL_COUNTS = Array.from({ length: 24 }, (_, i) => i + 1);

describe("the ceiling ladder", () => {
  it("lands every cumulative charge on a contract threshold", () => {
    for (const [owed, count] of [
      [180_008_219n, 4],
      [600_027_397n, 4],
      [1_000_000_000n, 7],
      [333_333_333n, 3],
      [12_345_678_901n, 24],
    ] as const) {
      let running = 0n;
      amounts(owed, count).forEach((amount, i) => {
        running += amount;
        assert.equal(
          running,
          thresholdFor(owed, i + 1, count),
          `${owed} over ${count}: rung ${i + 1} misses the contract threshold`
        );
      });
    }
  });

  it("spreads the residue one wei at a time instead of dumping it at the end", () => {
    // A total of q*4 + 3. Three instalments carry one extra wei; none carries
    // three. Dumping the residue on the final charge is what makes the last
    // instalment visibly different from the ones the borrower agreed to.
    const owed = 100_000_003n;
    assert.deepEqual(amounts(owed, 4), [25_000_001n, 25_000_001n, 25_000_001n, 25_000_000n]);
  });

  it("never lets two instalments of one plan differ by more than a wei", () => {
    for (const count of LEGAL_COUNTS) {
      for (const owed of [1_000_000_007n, 999_999_999_999n, 123_456_789n]) {
        const xs = amounts(owed, count);
        const spread = xs.reduce((a, b) => (a > b ? a : b), 0n) -
          xs.reduce((a, b) => (a < b ? a : b), xs[0]!);
        assert.ok(spread <= 1n, `${owed} over ${count} spread ${spread} wei`);
      }
    }
  });

  it("sums to exactly the total for every legal instalment count", () => {
    for (const count of LEGAL_COUNTS) {
      // Every possible remainder class, so no count/residue pair is missed.
      for (let r = 0; r < count; r++) {
        const owed = 500_000_000n + BigInt(r);
        assert.equal(
          total(amounts(owed, count)),
          owed,
          `${owed} over ${count} did not sum back`
        );
      }
    }
  });

  it("neither loses nor invents a wei across a wide spread of totals", () => {
    // Deterministic pseudo-random rather than fixed cases: the invariant is
    // meant to hold for every total a merchant can price an order at, and a
    // handful of hand-picked numbers is exactly how a residue bug survives.
    let seed = 88_172_645_463_325_252n;
    const next = () => {
      seed ^= (seed << 13n) & 0xffff_ffff_ffff_ffffn;
      seed ^= seed >> 7n;
      seed ^= (seed << 17n) & 0xffff_ffff_ffff_ffffn;
      return seed;
    };

    for (let i = 0; i < 500; i++) {
      const owed = next() % 1_000_000_000_000n;
      const count = Number(next() % 24n) + 1;
      assert.equal(total(amounts(owed, count)), owed, `${owed} over ${count}`);
    }
  });
});

describe("rounding residue", () => {
  it("splits four instalments of a total that does not divide by four", () => {
    // 450.000001 in USDC base units: 450000001 = 4 * 112500000 + 1.
    const owed = 450_000_001n;
    const xs = amounts(owed, 4);

    assert.deepEqual(xs, [112_500_001n, 112_500_000n, 112_500_000n, 112_500_000n]);
    assert.equal(total(xs), owed);
  });

  it("collects a one-wei residue rather than leaving it behind", () => {
    const owed = 120_000_001n;
    const xs = amounts(owed, 4);

    assert.equal(total(xs), owed);
    assert.equal(installmentsEarned(owed, total(xs), 4), 4);
  });

  it("closes a two-wei residue, which is what once stranded a paid-off loan", () => {
    // The failure this ladder exists to prevent. A uniform floor schedule --
    // total/count for every instalment -- charges the borrower four times, takes
    // every payment successfully, and still leaves two wei outstanding. The
    // contract's status never flips to Repaid, so the collateral stays locked
    // with no remaining instalment to collect against.
    const owed = 120_000_002n;

    const uniformFloor = owed / 4n;
    const collectedByFloorSchedule = uniformFloor * 4n;
    assert.equal(owed - collectedByFloorSchedule, 2n, "the historical two-wei shortfall");
    assert.equal(
      installmentsEarned(owed, collectedByFloorSchedule, 4),
      3,
      "four successful charges, three instalments earned, collateral stuck"
    );

    // The ladder takes the same four charges to exactly the total.
    const xs = amounts(owed, 4);
    assert.equal(total(xs), owed);
    assert.equal(installmentsEarned(owed, total(xs), 4), 4);
  });

  it("keeps the chain's earned counter level with the book at every charge", () => {
    // Drifting by one mid-plan is not cosmetic: the keeper reads the chain to
    // decide what is still owed, so a lagging counter re-charges an instalment
    // the borrower has already paid.
    for (const [owed, count] of [
      [120_000_002n, 4],
      [100_000_003n, 4],
      [7n, 3],
      [999_999_999_999n, 12],
    ] as const) {
      let repaid = 0n;
      amounts(owed, count).forEach((amount, i) => {
        repaid += amount;
        assert.equal(
          installmentsEarned(owed, repaid, count),
          i + 1,
          `${owed} over ${count}: after charge ${i + 1} the chain would say ${installmentsEarned(owed, repaid, count)}`
        );
      });
    }
  });
});

describe("degenerate plans", () => {
  it("builds a zero-amount schedule for a zero total without going negative", () => {
    const xs = amounts(0n, 4);
    assert.equal(xs.length, 4);
    assert.deepEqual(xs, [0n, 0n, 0n, 0n]);
    assert.equal(total(xs), 0n);
  });

  it("puts the whole residue-bearing total on a single instalment", () => {
    for (const owed of [0n, 1n, 450_000_001n, 2n ** 128n - 1n]) {
      assert.deepEqual(amounts(owed, 1), [owed]);
    }
  });

  it("still sums correctly when the total is smaller than the instalment count", () => {
    // Not reachable at realistic prices, but it pins the behaviour: the ladder
    // gives the single wei to the first instalment and schedules three
    // zero-amount charges rather than dividing by zero or going negative.
    const xs = amounts(1n, 4);
    assert.deepEqual(xs, [1n, 0n, 0n, 0n]);
    assert.equal(total(xs), 1n);
  });

  it("stays exact at the largest total the chain can hold", () => {
    // Loan.totalOwed is uint128 on chain. Base-unit amounts pass through
    // Number well before this, which is why every amount in the book is a
    // string parsed as BigInt and never a number.
    const owed = 2n ** 128n - 1n;
    for (const count of [2, 3, 4, 24]) {
      const xs = amounts(owed, count);
      assert.equal(total(xs), owed, `uint128 max over ${count}`);
      let running = 0n;
      xs.forEach((amount, i) => {
        running += amount;
        assert.equal(running, thresholdFor(owed, i + 1, count));
      });
    }
  });

  it("stays exact well beyond uint128, so the arithmetic itself is not the limit", () => {
    const owed = 2n ** 256n - 1n;
    assert.equal(total(amounts(owed, 24)), owed);
  });
});

describe("schedule metadata", () => {
  it("numbers instalments from one, contiguously", () => {
    assert.deepEqual(
      schedule(400n, 5).map((i) => i.index),
      [1, 2, 3, 4, 5]
    );
  });

  it("puts each due date one interval after the last, matching installmentDueAt", () => {
    // The contract's installmentDueAt(index) is startedAt + (index+1)*interval
    // on a zero-based index. A book that schedules from startAt itself would
    // make the keeper attempt a charge the contract still calls not-yet-due.
    schedule(400n, 4).forEach((inst, i) => {
      assert.equal(
        inst.dueAt.getTime(),
        START.getTime() + (i + 1) * WEEK * 1000,
        `instalment ${i + 1} due date`
      );
    });
  });

  it("opens every instalment scheduled with no attempts recorded", () => {
    for (const inst of schedule(400n, 4)) {
      assert.equal(inst.state, "scheduled");
      assert.equal(inst.attempts, 0);
      assert.equal(inst.paidAt, undefined);
      assert.equal(inst.settledAt, undefined);
    }
  });

  it("labels amounts in the token the plan is denominated in", () => {
    assert.equal(schedule(450_000_001n, 4)[0]!.amountDisplay, "112.50 USDC");

    const custom = buildInstallments({
      totalOwedRaw: 1_500_000_000_000_000_000n,
      count: 2,
      intervalSeconds: WEEK,
      startAt: START,
      decimals: 18,
      symbol: "pUSDC",
    });
    assert.equal(custom[0]!.amountDisplay, "0.75 pUSDC");
  });

  it("keeps amountRaw authoritative when the display rounds it away", () => {
    // The display is truncated to two places; the charge is not. Reading the
    // schedule off amountDisplay would under-collect by the residue on every
    // instalment.
    const inst = schedule(450_000_001n, 4)[0]!;
    assert.equal(inst.amountRaw, "112500001");
    assert.equal(inst.amountDisplay, "112.50 USDC");
  });
});

describe("repaidAfterCollecting at the closing boundary", () => {
  const OWED = 450_000_001n;

  it("lands exactly on the total after the last instalment of a real schedule", () => {
    let repaid = "0";
    for (const inst of schedule(OWED, 4)) {
      repaid = repaidAfterCollecting({
        totalOwedRaw: OWED.toString(),
        totalRepaidRaw: repaid,
        amountRaw: inst.amountRaw,
      });
    }
    // Equality, not >=: a book that overshoots writes off debt nobody paid.
    assert.equal(BigInt(repaid), OWED);
  });

  it("leaves the loan open one wei short, and closes it when that wei lands", () => {
    // The condition MongoLoanBook.recordAttempt flips `status` on. One wei
    // either side of it is the difference between a released collateral
    // position and one locked forever.
    const short = repaidAfterCollecting({
      totalOwedRaw: OWED.toString(),
      totalRepaidRaw: (OWED - 2n).toString(),
      amountRaw: "1",
    });
    assert.equal(BigInt(short), OWED - 1n);
    assert.ok(BigInt(short) < OWED, "still open");

    const closed = repaidAfterCollecting({
      totalOwedRaw: OWED.toString(),
      totalRepaidRaw: (OWED - 1n).toString(),
      amountRaw: "1",
    });
    assert.equal(BigInt(closed), OWED);
    assert.ok(BigInt(closed) >= OWED, "closed");
  });

  it("caps an oversized final charge at what is still owed", () => {
    const after = repaidAfterCollecting({
      totalOwedRaw: OWED.toString(),
      totalRepaidRaw: (OWED - 1n).toString(),
      amountRaw: "999999999",
    });
    assert.equal(BigInt(after), OWED);
  });

  it("credits nothing for a zero-amount instalment", () => {
    assert.equal(
      repaidAfterCollecting({
        totalOwedRaw: OWED.toString(),
        totalRepaidRaw: "1000",
        amountRaw: "0",
      }),
      "1000"
    );
  });

  it("credits nothing against a zero-total loan", () => {
    assert.equal(
      repaidAfterCollecting({ totalOwedRaw: "0", totalRepaidRaw: "0", amountRaw: "500" }),
      "0"
    );
  });

  it("keeps full precision at uint128 scale", () => {
    // Number would round this; the running total is a string parsed as BigInt
    // precisely so that it does not.
    const owed = 2n ** 128n - 1n;
    const after = repaidAfterCollecting({
      totalOwedRaw: owed.toString(),
      totalRepaidRaw: (owed - 3n).toString(),
      amountRaw: "1",
    });
    assert.equal(after, (owed - 2n).toString());
  });

  it("agrees with the chain's earned counter at the moment the loan closes", () => {
    const insts = schedule(OWED, 4);
    let repaid = 0n;
    insts.forEach((inst, i) => {
      repaid = BigInt(
        repaidAfterCollecting({
          totalOwedRaw: OWED.toString(),
          totalRepaidRaw: repaid.toString(),
          amountRaw: inst.amountRaw,
        })
      );
      assert.equal(installmentsEarned(OWED, repaid, 4), i + 1);
    });
    assert.equal(installmentsEarned(OWED, repaid, 4), 4);
  });
});
