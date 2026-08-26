/**
 * Loan-total arithmetic.
 *
 * This exists because of a bug found on live Sepolia data: two instalments were
 * marked paid in the book while the loan's totalRepaidRaw had only moved once.
 * The keeper recorded the instalment state on collection but left the loan
 * total to a separate chain sync, so between the two the book contradicted
 * itself -- and the borrower's dashboard told them they owed 450.02 when the
 * contract said 300.01.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildInstallments, repaidAfterCollecting } from "../dist/index.js";

/**
 * The contract's own ladder, restated here so the test fails if either side
 * drifts. `PolarisLoanEngine.thresholdFor` rounds each rung up; an instalment
 * schedule that rounds any other way settles a wei short and leaves the chain's
 * installmentsPaid counter lagging the book.
 */
function threshold(totalOwed: bigint, k: number, count: number): bigint {
  if (k <= 0) return 0n;
  if (k >= count) return totalOwed;
  const n = BigInt(count);
  return (totalOwed * BigInt(k) + n - 1n) / n;
}

/** A four-instalment plan of 150.00 each on a 600.03 total, as deployed. */
const PLAN = { totalOwedRaw: "600027397", amountRaw: "150006850" };

describe("repaidAfterCollecting", () => {
  it("adds the instalment to the running total", () => {
    assert.equal(
      repaidAfterCollecting({ ...PLAN, totalRepaidRaw: "150006850" }),
      "300013700"
    );
  });

  it("starts from zero on the first collection", () => {
    assert.equal(repaidAfterCollecting({ ...PLAN, totalRepaidRaw: "0" }), "150006850");
  });

  it("caps the final instalment at what is still owed", () => {
    // Three collected, 150.00 left on the schedule but only 150.006847 owed.
    // Crediting the raw amount would claim the loan was overpaid.
    const after = repaidAfterCollecting({ ...PLAN, totalRepaidRaw: "450020550" });
    assert.equal(after, PLAN.totalOwedRaw);
    assert.ok(BigInt(after) <= BigInt(PLAN.totalOwedRaw));
  });

  it("never exceeds the total however many times it is applied", () => {
    let repaid = "0";
    for (let i = 0; i < 10; i++) {
      repaid = repaidAfterCollecting({ ...PLAN, totalRepaidRaw: repaid });
    }
    assert.equal(repaid, PLAN.totalOwedRaw);
  });

  it("credits nothing once the loan is fully repaid", () => {
    assert.equal(
      repaidAfterCollecting({ ...PLAN, totalRepaidRaw: PLAN.totalOwedRaw }),
      PLAN.totalOwedRaw
    );
  });

  it("does not go backwards if the book already reads over the total", () => {
    // Defensive: a loan repaid out of band could leave repaid above owed, and
    // the fix for that is reconciliation, not silently subtracting here.
    const over = (BigInt(PLAN.totalOwedRaw) + 1n).toString();
    assert.equal(repaidAfterCollecting({ ...PLAN, totalRepaidRaw: over }), over);
  });

  it("walks a full plan to exactly the amount owed", () => {
    let repaid = "0";
    const steps: string[] = [];
    for (let i = 0; i < 4; i++) {
      repaid = repaidAfterCollecting({ ...PLAN, totalRepaidRaw: repaid });
      steps.push(repaid);
    }
    assert.deepEqual(steps, ["150006850", "300013700", "450020550", "600027397"]);
  });
});

describe("buildInstallments", () => {
  const schedule = (totalOwedRaw: bigint, count: number) =>
    buildInstallments({
      totalOwedRaw,
      count,
      intervalSeconds: 3600,
      startAt: new Date("2026-08-04T00:00:00Z"),
    });

  it("puts every instalment exactly on a contract threshold", () => {
    // The live loan whose 2-wei shortfall the reconciler caught: paying two
    // 45.002054 instalments left the chain reporting 1 earned, not 2.
    const total = 180_008_219n;
    const insts = schedule(total, 4);

    let running = 0n;
    insts.forEach((inst, i) => {
      running += BigInt(inst.amountRaw);
      assert.equal(
        running,
        threshold(total, i + 1, 4),
        `instalment ${i + 1} does not land on its threshold`
      );
    });
  });

  it("sums to exactly the amount owed", () => {
    for (const [total, count] of [
      [180_008_219n, 4],
      [120_005_479n, 4],
      [600_027_397n, 4],
      [1n, 4],
      [7n, 3],
      [999_999_999_999n, 12],
    ] as const) {
      const sum = schedule(total, count).reduce((a, i) => a + BigInt(i.amountRaw), 0n);
      assert.equal(sum, total, `${total} over ${count} did not sum back`);
    }
  });

  it("never issues a negative or zero-sum schedule", () => {
    for (const inst of schedule(7n, 3)) {
      assert.ok(BigInt(inst.amountRaw) >= 0n, "instalment went negative");
    }
  });

  it("keeps the chain's earned counter in step at every step", () => {
    // Walk the plan the way the keeper does and check that after k charges the
    // contract would agree exactly k instalments are earned.
    const total = 180_008_219n;
    const insts = schedule(total, 4);
    let repaid = 0n;

    insts.forEach((inst, i) => {
      repaid += BigInt(inst.amountRaw);
      let earned = 0;
      while (earned < 4 && repaid >= threshold(total, earned + 1, 4)) earned++;
      assert.equal(earned, i + 1, `after ${i + 1} charges the chain would say ${earned}`);
    });
  });

  it("schedules one interval apart, starting one interval out", () => {
    const insts = schedule(400n, 4);
    assert.equal(insts[0]!.dueAt.toISOString(), "2026-08-04T01:00:00.000Z");
    assert.equal(insts[3]!.dueAt.toISOString(), "2026-08-04T04:00:00.000Z");
  });
});
