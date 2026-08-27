import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeChange, type LoanShape, type ProfileShape } from "../src/chain/changes.ts";

/*
 * The differ decides whether the app announces a live update at all, and a
 * wrong `null` here is invisible: the numbers still change, so nothing looks
 * broken — the moment just never gets called out. That is exactly what these
 * pin down.
 */
const NOW = 1_700_000_000_000;
const profile = (over: Partial<ProfileShape> = {}): ProfileShape => ({
  score: 600,
  activeDebt: 100,
  lockedCollateral: 0,
  ...over,
});
const loan = (over: Partial<LoanShape> = {}): LoanShape => ({
  address: "loan-1",
  status: "active",
  totalRepaid: 0,
  totalOwed: 100,
  ...over,
});

describe("describeChange", () => {
  it("says nothing on the first read", () => {
    // There is no previous state to compare against, so there is no news.
    assert.equal(describeChange(null, profile(), [loan()], NOW), null);
  });

  it("says nothing when nothing a borrower cares about moved", () => {
    const before = { profile: profile(), loans: [loan()] };
    assert.equal(describeChange(before, profile(), [loan()], NOW), null);
  });

  it("names a collection, with the amount", () => {
    const before = { profile: profile(), loans: [loan()] };
    const after = describeChange(
      before,
      profile({ activeDebt: 75 }),
      [loan({ totalRepaid: 25 })],
      NOW,
    );
    assert.equal(after?.title, "Installment collected");
    assert.equal(after?.amount, 25);
    assert.match(after!.detail, /did not have to be online/);
  });

  it("prefers 'paid off' over 'collected' when the last one lands", () => {
    // Both are true of the same transaction; the bigger fact wins.
    const before = { profile: profile(), loans: [loan({ totalRepaid: 75 })] };
    const after = describeChange(
      before,
      profile({ activeDebt: 0 }),
      [loan({ status: "repaid", totalRepaid: 100 })],
      NOW,
    );
    assert.equal(after?.title, "Plan paid off");
  });

  it("names a score move in the right direction", () => {
    const before = { profile: profile(), loans: [loan()] };
    const up = describeChange(before, profile({ score: 612 }), [loan()], NOW);
    assert.equal(up?.title, "Credit score 600 → 612");
    assert.match(up!.detail, /raised it/);

    const down = describeChange(before, profile({ score: 560 }), [loan()], NOW);
    assert.match(down!.detail, /missed payment/);
  });

  it("names collateral moving, both ways", () => {
    const before = { profile: profile(), loans: [loan()] };
    const locked = describeChange(before, profile({ lockedCollateral: 50 }), [loan()], NOW);
    assert.equal(locked?.title, "Collateral locked");
    assert.equal(locked?.amount, 50);

    const back = describeChange(
      { profile: profile({ lockedCollateral: 50 }), loans: [loan()] },
      profile({ lockedCollateral: 0 }),
      [loan()],
      NOW,
    );
    assert.equal(back?.title, "Collateral returned");
    assert.equal(back?.amount, 50);
  });

  it("names a new plan without mistaking it for a repayment", () => {
    const before = { profile: profile(), loans: [loan()] };
    const opened = describeChange(
      before,
      profile({ activeDebt: 300 }),
      [loan(), loan({ address: "loan-2", totalOwed: 200 })],
      NOW,
    );
    assert.equal(opened?.title, "New plan opened");
    assert.equal(opened?.amount, 200);
  });

  it("ignores a loan it has never seen rather than counting it as repaid", () => {
    // A plan opened on another device appears with totalRepaid already > 0.
    // Treating that as a collection would announce money that never moved here.
    const before = { profile: profile(), loans: [] as LoanShape[] };
    const change = describeChange(
      before,
      profile(),
      [loan({ totalRepaid: 40 })],
      NOW,
    );
    assert.equal(change, null);
  });
});
