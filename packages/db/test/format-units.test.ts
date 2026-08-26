/**
 * Money as the borrower and the merchant read it.
 *
 * formatUnits is display-only -- amountRaw is always the authority -- but it is
 * what every dashboard number in the product is rendered through, and a wrong
 * string here is indistinguishable from a wrong balance to the person reading
 * it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatUnits } from "../dist/index.js";

/** Anything a human should ever be shown as an amount. */
const DECIMAL = /^-?\d+\.\d{2}$/;

describe("formatUnits", () => {
  it("renders base units as a two-place decimal", () => {
    assert.equal(formatUnits(0n, 6), "0.00");
    assert.equal(formatUnits(1_000_000n, 6), "1.00");
    assert.equal(formatUnits(1_050_000n, 6), "1.05");
    assert.equal(formatUnits(450_000_001n, 6), "450.00");
  });

  it("truncates rather than rounds, so a balance is never overstated", () => {
    // Rounding up would show a borrower 1.00 owing when they owe 0.999999 --
    // and then collect the smaller amount, which reads as a short payment.
    assert.equal(formatUnits(999_999n, 6), "0.99");
    assert.equal(formatUnits(1_999_999n, 6), "1.99");
    assert.equal(formatUnits(150_006_850n, 6), "150.00");
  });

  it("shows sub-cent dust as zero while the ledger keeps every wei", () => {
    // Deliberate: the two-place display is not the ledger. Any code that reads
    // an amount back out of this string has already lost the residue.
    assert.equal(formatUnits(1n, 6), "0.00");
    assert.equal(formatUnits(9_999n, 6), "0.00");
  });

  it("keeps full precision on a balance far past Number.MAX_SAFE_INTEGER", () => {
    // Every digit spelled out: a float somewhere in this path would round the
    // tail and nobody would notice until a reconciliation disagreed.
    assert.equal(
      formatUnits(2n ** 128n - 1n, 6),
      "340282366920938463463374607431768.21"
    );
    assert.equal(formatUnits(9_007_199_254_740_993_000_000n, 6), "9007199254740993.00");
  });

  it("honours a token's own decimals", () => {
    assert.equal(formatUnits(1_500_000_000_000_000_000n, 18), "1.50");
    assert.equal(formatUnits(1n, 18), "0.00");
    assert.equal(formatUnits(150n, 2), "1.50");
  });

  it("always produces a parseable decimal for any non-negative amount", () => {
    for (const value of [0n, 1n, 999_999n, 1_000_000n, 2n ** 128n - 1n]) {
      assert.match(formatUnits(value, 6), DECIMAL, `value ${value}`);
    }
  });

  // The two cases below fail. See the note in the report: formatUnits applies
  // padStart/slice to the remainder without accounting for its sign, so a
  // negative amount comes out malformed. It is reachable -- the borrower and
  // merchant dashboards both compute `BigInt(totalOwedRaw) - BigInt(totalRepaidRaw)`
  // with no clamp and render the result through this function, and
  // repaidAfterCollecting explicitly tolerates a book where repaid exceeds owed.
  it("formats a negative amount as a signed decimal", () => {
    assert.equal(formatUnits(-1_500_000n, 6), "-1.50");
    for (const value of [-1_000_000n, -1_500_000n, -999_999n, -1n]) {
      assert.match(formatUnits(value, 6), DECIMAL, `value ${value}`);
    }
  });

  it("does not drop the sign on an overpaid balance", () => {
    // Half a unit overpaid must not render as a positive fraction of a unit.
    assert.equal(formatUnits(-500_000n, 6), "-0.50");
  });
});
