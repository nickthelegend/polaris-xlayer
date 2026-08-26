/**
 * The two read-only summaries an operator acts on: how much money the book and
 * the chain disagree about, and whether the keeper is still running.
 *
 * Both are pure functions over a report object, which is the whole point --
 * they can be exercised without a database, and an operator can trust that the
 * number on screen is a function of the data rather than of the connection.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { materialExposure, renderHealth, STALE_AFTER_MINUTES } from "../dist/index.js";
import type { Drift, HealthReport, KeeperJob, ReconcileReport } from "../dist/index.js";

const report = (drift: Drift[]): ReconcileReport => ({
  chainLoans: 10,
  bookLoans: 10,
  checked: 10,
  drift,
  clean: drift.length === 0,
});

describe("materialExposure", () => {
  it("is zero when the book and the chain agree", () => {
    assert.equal(materialExposure(report([])), 0n);
  });

  it("sums the disputed value across loans", () => {
    const exposure = materialExposure(
      report([
        { loanId: "1", field: "totalRepaid", chain: "0.00", book: "50.00", materialRaw: "50000000" },
        { loanId: "2", field: "totalRepaid", chain: "10.00", book: "0.00", materialRaw: "10000000" },
      ])
    );
    assert.equal(exposure, 60_000_000n);
  });

  it("adds in base units without float loss", () => {
    // Two deltas that are each one above Number.MAX_SAFE_INTEGER. Summed as
    // numbers they would both round down and the total would be four wei
    // short -- small, but the entire point of the report is that it is exact.
    const one = "9007199254740993";
    const exposure = materialExposure(
      report([
        { loanId: "1", field: "totalRepaid", chain: "a", book: "b", materialRaw: one },
        { loanId: "2", field: "totalRepaid", chain: "a", book: "b", materialRaw: one },
      ])
    );
    assert.equal(exposure, 18_014_398_509_481_986n);
    assert.equal(typeof exposure, "bigint");
  });

  it("counts a disagreement in either direction as exposure", () => {
    // The book reading high and the book reading low are both money the
    // operator cannot account for; neither cancels the other out.
    const exposure = materialExposure(
      report([
        { loanId: "1", field: "totalRepaid", chain: "0.00", book: "5.00", materialRaw: "5000000" },
        { loanId: "2", field: "totalRepaid", chain: "5.00", book: "0.00", materialRaw: "5000000" },
      ])
    );
    assert.equal(exposure, 10_000_000n);
  });

  it("ignores drift that carries no measurable value", () => {
    // A status or counter disagreement is real drift but has no amount
    // attached; inventing one would be worse than reporting zero.
    assert.equal(
      materialExposure(
        report([
          { loanId: "1", field: "installmentsPaid", chain: "2", book: "1" },
          { loanId: "2", field: "status", chain: "repaid", book: "active" },
          { loanId: "3", field: "orphaned", chain: "absent", book: "ord_1 (active)" },
        ])
      ),
      0n
    );
  });
});

const health = (over: Partial<HealthReport> = {}): HealthReport => ({
  status: "healthy",
  checkedAt: "2026-08-06T12:00:00.000Z",
  jobs: [
    {
      job: "collection",
      status: "healthy",
      lastRunAt: "2026-08-06T11:55:00.000Z",
      minutesSinceLastRun: 5,
      lastResult: "3 considered · 3 ok · 0 failed",
    },
  ],
  book: {
    activeLoans: 4,
    overdueInstalments: 1,
    overdueValue: "45.00",
    inDunning: 1,
    liquidationCandidates: 0,
    unsettledValue: "120.00",
    collectionRate: 87.5,
  },
  incidents: [],
  ...over,
});

describe("renderHealth", () => {
  it("leads with the overall verdict", () => {
    assert.match(renderHealth(health()).split("\n")[0]!, /^PolarisPay keeper — HEALTHY$/);
    assert.match(renderHealth(health({ status: "down" })).split("\n")[0]!, /DOWN$/);
  });

  it("distinguishes a job that has never run from one that ran just now", () => {
    // "0m ago" for a job that has never started would read as perfectly
    // healthy, which is the exact failure this report exists to catch.
    const out = renderHealth(
      health({
        jobs: [
          {
            job: "settlement",
            status: "unknown",
            lastRunAt: null,
            minutesSinceLastRun: null,
            lastResult: null,
          },
        ],
      })
    );
    assert.match(out, /never run/);
    assert.doesNotMatch(out, /0m ago/);
  });

  it("marks a stalled job and prints the incident behind it", () => {
    const out = renderHealth(
      health({
        status: "down",
        jobs: [
          {
            job: "collection",
            status: "down",
            lastRunAt: "2026-08-06T08:00:00.000Z",
            minutesSinceLastRun: 240,
            lastResult: "0 considered · 0 ok · 0 failed",
          },
        ],
        incidents: ["collection has not run for 240 minutes (threshold 90)."],
      })
    );
    assert.match(out, /DOWN collection/);
    assert.match(out, /240m ago/);
    assert.match(out, /incidents:/);
    assert.match(out, /- collection has not run for 240 minutes/);
  });

  it("says nothing about incidents when there are none", () => {
    assert.doesNotMatch(renderHealth(health()), /incidents:/);
  });

  it("reports the book totals it was given, unrounded except for the rate", () => {
    const out = renderHealth(health());
    assert.match(out, /collected, not paid out\s+120\.00/);
    assert.match(out, /overdue instalments\s+1 \(45\.00\)/);
    assert.match(out, /collection rate\s+87\.5%/);
  });

  it("renders every status without throwing on an unknown marker", () => {
    for (const status of ["healthy", "degraded", "down", "unknown"] as const) {
      const out = renderHealth(
        health({ status, jobs: [{ job: "liquidation", status, lastRunAt: null, minutesSinceLastRun: null, lastResult: null }] })
      );
      assert.match(out, /liquidation/);
      assert.doesNotMatch(out, /undefined/);
    }
  });
});

describe("STALE_AFTER_MINUTES", () => {
  it("gives every keeper job a threshold", () => {
    // A job with no entry compares against undefined, which is never greater,
    // so it would report healthy forever after it stopped -- silence being the
    // failure mode this whole check exists for.
    const jobs: KeeperJob[] = [
      "collection",
      "subscriptions",
      "close-out",
      "liquidation",
      "settlement",
    ];
    for (const job of jobs) {
      const threshold = STALE_AFTER_MINUTES[job];
      assert.equal(typeof threshold, "number", `${job} has no staleness threshold`);
      assert.ok(threshold > 0, `${job} threshold must be positive`);
    }
    assert.equal(Object.keys(STALE_AFTER_MINUTES).length, jobs.length, "undeclared job");
  });

  it("catches a stopped collection pass within one collection window", () => {
    // Collection is the job money flows through; its threshold has to stay
    // tighter than the slower sweeps or a stopped keeper is found by a
    // merchant asking where their settlement is.
    assert.ok(STALE_AFTER_MINUTES.collection < STALE_AFTER_MINUTES.settlement);
    assert.ok(STALE_AFTER_MINUTES.collection < STALE_AFTER_MINUTES["close-out"]);
    assert.ok(STALE_AFTER_MINUTES.collection <= 120);
  });
});
