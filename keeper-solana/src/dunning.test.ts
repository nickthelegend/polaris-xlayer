import { test } from "node:test";
import assert from "node:assert/strict";

import { nextDunningStep, partialCollection, DEFAULT_LADDER } from "./dunning.ts";
import { classify, isIndefinite } from "./errors.ts";

const now = new Date("2026-09-21T09:00:00Z");

test("an operator failure never reaches the borrower", () => {
  const d = nextDunningStep({ attemptsMade: 1, failureKind: "operator", now });
  assert.equal(d.action, "abandon");
  assert.equal((d as any).notify, false);
});

test("a state rejection is not retried on a timer", () => {
  // Waiting will not make a closed loan collectable.
  const d = nextDunningStep({ attemptsMade: 1, failureKind: "would_revert", now });
  assert.equal(d.action, "abandon");
});

test("insufficient funds walks the business ladder and then escalates", () => {
  for (let attempts = 0; attempts < DEFAULT_LADDER.length; attempts++) {
    const d = nextDunningStep({ attemptsMade: attempts, failureKind: "insufficient_funds", now });
    assert.equal(d.action, "retry", `attempt ${attempts} should retry`);
  }
  const done = nextDunningStep({
    attemptsMade: DEFAULT_LADDER.length,
    failureKind: "insufficient_funds",
    now,
  });
  assert.equal(done.action, "escalate");
});

test("a lost delegation gets its own short ladder, and notifies immediately", () => {
  // Distinct from the money ladder: the borrower has exactly one action to
  // take, and until they take it every retry fails identically.
  const first = nextDunningStep({ attemptsMade: 0, failureKind: "delegation_lost", now });
  assert.equal(first.action, "retry");
  assert.equal((first as any).notify, true);

  const done = nextDunningStep({ attemptsMade: 2, failureKind: "delegation_lost", now });
  assert.equal(done.action, "escalate");
});

test("an unknown outcome is reconciled, never resent blind", () => {
  // The failure that double-charges a borrower if you get it wrong.
  const d = nextDunningStep({ attemptsMade: 1, failureKind: "indefinite", now });
  assert.equal(d.action, "retry");
  assert.equal((d as any).stage.label, "reconcile");
  assert.equal((d as any).notify, false);
});

test("a partial collection beats collecting nothing, above the floor", () => {
  const p = partialCollection({ due: 50_000_000n, available: 38_000_000n });
  assert.equal(p.action, "collect-partial");
  assert.equal((p as any).amount, 38_000_000n);
  assert.equal((p as any).shortfall, 12_000_000n);
});

test("dust is not worth the fee", () => {
  const p = partialCollection({ due: 50_000_000n, available: 300_000n });
  assert.equal(p.action, "skip");
});

test("a revoked delegate is told apart from an exhausted one", () => {
  // One means the borrower removed us; the other means the amount ran out.
  // They need different messages, so they cannot share an error kind.
  assert.equal(
    classify({ message: "x", logs: ["Program log: Error Code: NotDelegated"] }).kind,
    "delegation_lost",
  );
  assert.equal(
    classify({ message: "x", logs: ["Program log: Error Code: InsufficientDelegation"] }).kind,
    "delegation_exhausted",
  );
});

test("a broke keeper is not mistaken for a broke borrower", () => {
  // Both read as "insufficient funds" at a glance. Only one is our bill.
  assert.equal(classify({ message: "Transfer: insufficient lamports 100, need 5000" }).kind, "operator");
  assert.equal(
    classify({ message: "custom program error: 0x1", logs: ["Program log: Instruction: Transfer"] }).kind,
    "insufficient_funds",
  );
});

test("an expired blockhash is transient, and transient outcomes are indefinite", () => {
  const c = classify({ message: "Blockhash not found" });
  assert.equal(c.kind, "transient");
  assert.equal(isIndefinite(c.kind), true);
  // Which is what stops the keeper resending a charge that may still be settling.
  assert.equal(isIndefinite("insufficient_funds"), false);
});

test("a duplicate signature means the original landed", () => {
  assert.equal(classify({ message: "This transaction has already been processed" }).kind, "indefinite");
});
