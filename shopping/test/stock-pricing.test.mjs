import { test } from "node:test";
import assert from "node:assert/strict";
import {
  usdToUnits, sharesForTotal, quoteForShares, feeFor, formatUsd, formatShares,
} from "../lib/stock-pricing.ts";

// The live numbers at the time of writing: $325.62 a share, 31.5% LTV after
// the after-hours haircut, 1% origination fee.
const P = {
  usdPerShare: 32562000000n,
  ltvBps: 3150n,
  originationFeeBps: 100n,
  interestAprBps: 1200n,
  tenor: BigInt(7 * 86400),
};

test("dollars convert without touching a float", () => {
  assert.equal(usdToUnits("45.00"), 45_000000n);
  assert.equal(usdToUnits("0.01"), 10000n);
  assert.equal(usdToUnits("1234.56"), 1234_560000n);
  // The classic float trap: 0.1 + 0.2 territory.
  assert.equal(usdToUnits("86.99"), 86_990000n);
});

test("a basket's shares actually cover the basket", () => {
  for (const total of ["45.00", "12.00", "29.99", "1.00", "999.99"]) {
    const units = usdToUnits(total);
    const shares = sharesForTotal(units, P);
    const q = quoteForShares(shares, P);
    // Rounded up, so the merchant is never left short.
    assert.ok(q.merchantReceives >= units, `${total}: got ${q.merchantReceives} for ${units}`);
    // And minimal: one unit fewer must not cover it.
    if (shares > 0n) {
      assert.ok(
        quoteForShares(shares - 1n, P).merchantReceives < units,
        `${total}: locking more shares than needed`,
      );
    }
  }
});

test("the quote never exceeds the ceiling the engine enforces", () => {
  // The engine's constraint is borrow + fee(borrow) <= allowed. This mirrors
  // it exactly, including the walk-back the contract does after integer
  // division — getting it wrong asked for one unit too many and every
  // checkout reverted with ExceedsMaxLtv.
  for (const shares of [10n ** 17n, 10n ** 18n, 5n * 10n ** 18n, 25n * 10n ** 18n]) {
    const q = quoteForShares(shares, P);
    assert.ok(
      q.merchantReceives + q.fee <= q.ceiling,
      `${shares}: ${q.merchantReceives} + ${q.fee} > ${q.ceiling}`,
    );
  }
});

test("the fee is origination plus interest for the tenor, not a slice of the ceiling", () => {
  const principal = 1000_000000n;
  const expected =
    (principal * P.originationFeeBps) / 10000n +
    (principal * P.interestAprBps * P.tenor) / (10000n * 365n * 24n * 60n * 60n);
  assert.equal(feeFor(principal, P), expected);
  // A seven-day loan costs origination plus a touch under a quarter percent.
  assert.ok(feeFor(principal, P) > (principal * 100n) / 10000n);
});

test("a zero price cannot ask for shares", () => {
  assert.equal(sharesForTotal(45_000000n, { ...P, usdPerShare: 0n }), 0n);
  assert.equal(sharesForTotal(45_000000n, { ...P, ltvBps: 0n }), 0n);
});

test("a malformed amount is refused, not silently zero", () => {
  assert.throws(() => usdToUnits("abc"));
  assert.throws(() => usdToUnits("-5"));
  assert.throws(() => usdToUnits(""));
});

test("formatting round-trips", () => {
  assert.equal(formatUsd(45_000000n), "45.00");
  assert.equal(formatUsd(1234_567890n), "1,234.56");
  assert.equal(formatShares(10n ** 18n), "1.0000");
  assert.equal(formatShares(1500000000000000000n), "1.5000");
});
