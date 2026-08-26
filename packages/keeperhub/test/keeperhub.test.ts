/**
 * Coverage for the paths where a bug costs real money: encoding, idempotency
 * scoping, simulate-gating, terminal reconciliation, and the dunning branch.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Tests run against the built artifact, so they exercise exactly what ships.
import {
  chargeKey,
  encodeArgs,
  InMemoryReceiptStore,
  KeeperHubClient,
  KeeperHubError,
  nextDunningStep,
  partialCollection,
  PolarisKeeper,
  selfCure,
  isIndefinite,
  errorFromResponse,
} from "../dist/index.js";

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown };

function stubFetch(handlers: Handler[]): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit; body: any }>;
} {
  const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
  let i = 0;
  const fetchImpl = (async (url: any, init: any) => {
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i++;
    calls.push({
      url: String(url),
      init,
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const { status, body } = handler!(String(url), init);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    } as any;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const DEPLOYMENT = {
  chainId: 11_155_111,
  loanEngine: "0xLoanEngine",
  payments: "0xPayments",
};

describe("argument encoding", () => {
  it("stringifies the argument array, because the routes reject a real array", () => {
    assert.equal(encodeArgs(["0xabc", "1000"]), '["0xabc","1000"]');
  });

  it("serialises bigint args rather than throwing on JSON.stringify", () => {
    assert.equal(encodeArgs([1n, 250000n]), '["1","250000"]');
  });

  it("sends chainId as a string", async () => {
    const { fetchImpl, calls } = stubFetch([
      () => ({ status: 200, body: { simulated: true, gasEstimate: "21000" } }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    await kh.simulateContractCall({
      contractAddress: "0xc",
      chainId: 8453,
      functionName: "repay",
    });
    assert.equal(calls[0]!.body.chainId, "8453");
    assert.equal(typeof calls[0]!.body.chainId, "string");
  });

  it("sends simulate as a real boolean, not a string", async () => {
    const { fetchImpl, calls } = stubFetch([
      () => ({ status: 200, body: { simulated: true } }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    await kh.simulateContractCall({
      contractAddress: "0xc",
      chainId: 8453,
      functionName: "repay",
    });
    assert.equal(calls[0]!.body.simulate, true);
  });
});

describe("idempotency scoping", () => {
  // Only half the rule: the key advances on a definite failure so a cached one
  // cannot replay forever, and holds when the outcome is unknown. See the
  // indefinite-outcomes suite for the other half.
  it("varies the key per attempt so a retry is not served a cached failure", () => {
    assert.equal(chargeKey("loan-1-inst-2", 1), "loan-1-inst-2-a1");
    assert.notEqual(chargeKey("loan-1-inst-2", 1), chargeKey("loan-1-inst-2", 2));
  });

  it("sends the key as the Idempotency-Key header", async () => {
    const { fetchImpl, calls } = stubFetch([
      () => ({ status: 202, body: { executionId: "e1", status: "pending" } }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    await kh.executeContractCall(
      { contractAddress: "0xc", chainId: 8453, functionName: "repay" },
      { idempotencyKey: "loan-1-inst-2-a1" }
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers["Idempotency-Key"], "loan-1-inst-2-a1");
  });
});

describe("auth guard", () => {
  it("rejects a non-kh_ key up front instead of 401ing on every call", () => {
    assert.throws(
      () => new KeeperHubClient({ apiKey: "oauth_token" }),
      (e: unknown) => e instanceof KeeperHubError && e.kind === "auth"
    );
  });
});

describe("simulate gating", () => {
  it("throws insufficient_funds when the dry-run reports a balance shortfall", async () => {
    const { fetchImpl } = stubFetch([
      () => ({
        status: 200,
        body: { success: false, revertReason: "ERC20: transfer amount exceeds balance" },
      }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    await assert.rejects(
      () =>
        kh.assertWouldSucceed({
          contractAddress: "0xc",
          chainId: 8453,
          functionName: "repay",
        }),
      (e: unknown) => e instanceof KeeperHubError && e.kind === "insufficient_funds"
    );
  });

  it("does not broadcast when the simulation fails", async () => {
    const { fetchImpl, calls } = stubFetch([
      () => ({ status: 200, body: { success: false, revertReason: "execution reverted" } }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    const keeper = new PolarisKeeper(kh, DEPLOYMENT, new InMemoryReceiptStore());

    const receipt = await keeper.collectInstallment({
      loanId: "7",
      installment: 2,
      amountRaw: "50000000",
    });

    assert.equal(receipt.outcome, "failed");
    assert.equal(calls.length, 1, "only the simulation should have been sent");
    assert.equal(calls[0]!.body.simulate, true);
  });
});

describe("terminal reconciliation", () => {
  it("polls /status and records the sponsored transaction hash", async () => {
    const { fetchImpl, calls } = stubFetch([
      () => ({ status: 200, body: { success: true, gasEstimate: "48000" } }),
      () => ({ status: 202, body: { executionId: "exec_9", status: "pending" } }),
      () => ({
        status: 200,
        body: {
          executionId: "exec_9",
          status: "completed",
          sponsored: true,
          transactionHash: "0xdeadbeef",
          transactionLink: "https://sepolia.etherscan.io/tx/0xdeadbeef",
        },
      }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    const store = new InMemoryReceiptStore();
    const keeper = new PolarisKeeper(kh, DEPLOYMENT, store);

    const receipt = await keeper.collectInstallment({
      loanId: "7",
      installment: 1,
      amountRaw: "50000000",
      amountDisplay: "50 USDC",
    });

    assert.equal(receipt.outcome, "succeeded");
    assert.equal(receipt.execution?.transactionHash, "0xdeadbeef");
    assert.equal(receipt.execution?.sponsored, true);
    assert.match(calls[2]!.url, /\/api\/execute\/exec_9\/status$/);
    assert.equal((await store.list({ loanId: "7" })).length, 1);
  });
});

describe("liquidation", () => {
  it("records a skip, and sends nothing, when the loan is healthy", async () => {
    const { fetchImpl } = stubFetch([
      () => ({ status: 200, body: { executed: false, conditionResult: false } }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    const keeper = new PolarisKeeper(kh, DEPLOYMENT, new InMemoryReceiptStore());

    const receipt = await keeper.liquidateIfUnhealthy({ loanId: "42" });
    assert.equal(receipt.outcome, "skipped");
    assert.equal(receipt.execution, undefined);
  });

  it("checks and liquidates in one call, with no separate read", async () => {
    const { fetchImpl, calls } = stubFetch([
      () => ({ status: 202, body: { executionId: "exec_liq", status: "pending" } }),
      () => ({
        status: 200,
        body: { executionId: "exec_liq", status: "completed", transactionHash: "0xliq" },
      }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    const keeper = new PolarisKeeper(kh, DEPLOYMENT, new InMemoryReceiptStore());

    const receipt = await keeper.liquidateIfUnhealthy({ loanId: "42" });

    assert.equal(receipt.outcome, "succeeded");
    assert.match(calls[0]!.url, /check-and-execute$/);
    assert.equal(calls[0]!.body.functionName, "checkLiquidatable");
    assert.equal(calls[0]!.body.action.functionName, "liquidate");
    assert.equal(calls[0]!.body.condition.value, "true");
  });
});

describe("subscription charges", () => {
  it("checks and charges in one call, so a cancellation cannot be raced", async () => {
    const { fetchImpl, calls } = stubFetch([
      () => ({ status: 202, body: { executionId: "exec_sub", status: "pending" } }),
      () => ({
        status: 200,
        body: { executionId: "exec_sub", status: "completed", transactionHash: "0xsub" },
      }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    const keeper = new PolarisKeeper(kh, DEPLOYMENT, new InMemoryReceiptStore());

    const receipt = await keeper.chargeSubscription({ subscriptionId: "4" });

    assert.equal(receipt.outcome, "succeeded");
    assert.equal(receipt.execution?.transactionHash, "0xsub");
    assert.match(calls[0]!.url, /check-and-execute$/);
    assert.equal(calls[0]!.body.functionName, "isChargeDue");
    assert.equal(calls[0]!.body.action.functionName, "chargeDue");
    assert.equal(calls[0]!.body.condition.value, "true");
    assert.equal(calls[0]!.body.contractAddress, "0xPayments");
  });

  it("records a skip, and sends nothing, when the period is not up", async () => {
    const { fetchImpl } = stubFetch([
      () => ({ status: 200, body: { executed: false, conditionResult: false } }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    const keeper = new PolarisKeeper(kh, DEPLOYMENT, new InMemoryReceiptStore());

    const receipt = await keeper.chargeSubscription({ subscriptionId: "4" });
    assert.equal(receipt.outcome, "skipped");
    assert.equal(receipt.execution, undefined);
  });

  it("fails loudly rather than silently when PolarisPayments is not configured", async () => {
    const { fetchImpl, calls } = stubFetch([]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    const keeper = new PolarisKeeper(
      kh,
      { chainId: 11_155_111, loanEngine: "0xLoanEngine" },
      new InMemoryReceiptStore()
    );

    const receipt = await keeper.chargeSubscription({ subscriptionId: "4" });
    assert.equal(receipt.outcome, "failed");
    assert.match(receipt.error?.message ?? "", /POLARIS_PAYMENTS/);
    // The point of failing here is to send nothing at all.
    assert.equal(calls.length, 0);
  });

  it("scopes the idempotency key per attempt, so a retry is not served the failure", async () => {
    const { fetchImpl, calls } = stubFetch([
      () => ({ status: 202, body: { executionId: "exec_a", status: "pending" } }),
      () => ({ status: 200, body: { executionId: "exec_a", status: "completed" } }),
      () => ({ status: 202, body: { executionId: "exec_b", status: "pending" } }),
      () => ({ status: 200, body: { executionId: "exec_b", status: "completed" } }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    const keeper = new PolarisKeeper(kh, DEPLOYMENT, new InMemoryReceiptStore());

    await keeper.chargeSubscription({ subscriptionId: "4", attempt: 1 });
    await keeper.chargeSubscription({ subscriptionId: "4", attempt: 2 });

    const keys = calls
      .filter((c) => c.url.endsWith("check-and-execute"))
      .map((c) => (c.init.headers as Record<string, string>)["Idempotency-Key"]);

    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1]);
    // KeeperHub caches failures as well as successes, so an unscoped key would
    // serve attempt 2 whatever happened on attempt 1.
    assert.deepEqual(keys, ["subscription-4-charge-a1", "subscription-4-charge-a2"]);
  });
});

describe("dunning", () => {
  const now = new Date("2026-08-03T00:00:00Z");

  it("waits on the business ladder for an insufficient-funds miss", () => {
    const d = nextDunningStep({ attemptsMade: 1, failureKind: "insufficient_funds", now });
    assert.equal(d.action, "retry");
    if (d.action === "retry") {
      assert.equal(d.stage.delayHours, 6);
      assert.equal(d.at.toISOString(), "2026-08-03T06:00:00.000Z");
    }
  });

  it("never duns the borrower for an operator-side failure", () => {
    for (const kind of ["auth", "spend_cap"] as const) {
      const d = nextDunningStep({ attemptsMade: 1, failureKind: kind, now });
      assert.equal(d.action, "abandon");
    }
  });

  it("does not retry a protocol-level revert, which state will not fix", () => {
    const d = nextDunningStep({ attemptsMade: 1, failureKind: "would_revert", now });
    assert.equal(d.action, "abandon");
  });

  it("escalates to liquidation once the ladder is exhausted", () => {
    const d = nextDunningStep({ attemptsMade: 5, failureKind: "insufficient_funds", now });
    assert.equal(d.action, "escalate");
  });
});

describe("transport", () => {
  it("retries a 429 and then succeeds", async () => {
    let n = 0;
    const { fetchImpl } = stubFetch([
      () => {
        n++;
        return n === 1
          ? { status: 429, body: { error: "Rate limit exceeded" } }
          : { status: 200, body: { simulated: true } };
      },
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl, maxRetries: 2 });
    const res = await kh.simulateContractCall({
      contractAddress: "0xc",
      chainId: 8453,
      functionName: "repay",
    });
    assert.equal(res.simulated, true);
    assert.equal(n, 2);
  });

  it("does not retry a 400, which will fail identically every time", async () => {
    let n = 0;
    const { fetchImpl } = stubFetch([
      () => {
        n++;
        return { status: 400, body: { error: "Missing required field", field: "chainId" } };
      },
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl, maxRetries: 3 });
    await assert.rejects(
      () =>
        kh.simulateContractCall({
          contractAddress: "0xc",
          chainId: 8453,
          functionName: "repay",
        }),
      (e: unknown) =>
        e instanceof KeeperHubError && e.kind === "validation" && e.field === "chainId"
    );
    assert.equal(n, 1);
  });

  it("classifies a spend-cap 403 separately from an auth 403", async () => {
    const { fetchImpl } = stubFetch([
      () => ({ status: 403, body: { error: "Daily spend cap exceeded" } }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    await assert.rejects(
      () =>
        kh.simulateContractCall({
          contractAddress: "0xc",
          chainId: 8453,
          functionName: "repay",
        }),
      (e: unknown) => e instanceof KeeperHubError && e.kind === "spend_cap"
    );
  });
});

describe("partial collection", () => {
  const due = 50_000_000n; // 50.00

  it("collects what is available rather than nothing when the borrower is short", () => {
    const d = partialCollection({ dueRaw: due, availableRaw: 38_000_000n });
    assert.equal(d.action, "collect-partial");
    if (d.action === "collect-partial") {
      assert.equal(d.amountRaw, "38000000");
      assert.equal(d.shortfallRaw, "12000000");
    }
  });

  it("defers to normal collection when the full amount is available", () => {
    assert.equal(partialCollection({ dueRaw: due, availableRaw: due }).action, "skip");
  });

  it("skips dust, because the gas costs more than it recovers", () => {
    const d = partialCollection({ dueRaw: due, availableRaw: 300_000n });
    assert.equal(d.action, "skip");
    if (d.action === "skip") assert.match(d.reason, /floor/);
  });

  it("skips an empty wallet", () => {
    assert.equal(partialCollection({ dueRaw: due, availableRaw: 0n }).action, "skip");
  });

  it("honours an explicit floor over the default", () => {
    const d = partialCollection({ dueRaw: due, availableRaw: 3_000_000n, floorRaw: 1_000_000n });
    assert.equal(d.action, "collect-partial");
  });
});

describe("self cure", () => {
  it("lets a borrower who topped up retry immediately", () => {
    const r = selfCure({ attemptsMade: 2 });
    assert.equal(r.allowed, true);
  });

  it("does NOT reset the attempt counter, so cycling cannot dodge escalation", () => {
    assert.equal(selfCure({ attemptsMade: 3 }).attemptsMade, 3);
  });

  it("refuses once the ladder is exhausted", () => {
    const r = selfCure({ attemptsMade: 5 });
    assert.equal(r.allowed, false);
    assert.match(r.reason ?? "", /liquidation/);
  });
});

describe("indefinite outcomes", () => {
  // The rule the idempotency key turns on: rotate after a definite failure so a
  // cached one cannot replay forever, hold it when the outcome is unknown so a
  // still-settling charge is not sent twice.
  it("treats a timeout and a 5xx as unknown, since the call may still be settling", () => {
    assert.equal(isIndefinite("timeout"), true);
    assert.equal(isIndefinite("server"), true);
  });

  it("treats a revert or a rejection as definite, because nothing was broadcast", () => {
    for (const kind of ["would_revert", "reverted", "validation", "auth", "insufficient_funds"]) {
      assert.equal(isIndefinite(kind), false, `${kind} should be definite`);
    }
  });

  it("treats a missing kind as definite, so a first attempt gets a fresh key", () => {
    assert.equal(isIndefinite(undefined), false);
  });

  // rate_limit is definite in the sense that matters here: the request was
  // rejected before execution, so nothing is in flight to collide with.
  it("treats a rate limit as definite", () => {
    assert.equal(isIndefinite("rate_limit"), false);
  });
});

describe("409 classification", () => {
  // Found in production: the keeper dunned a live instalment because a 409
  // fell through to `unknown`, which is not retryable. The charge behind it
  // had in fact succeeded.
  it("treats an in-progress duplicate as retryable, not terminal", () => {
    const err = errorFromResponse(409, {
      error: "A request with this Idempotency-Key is already being processed.",
      code: "idempotency_in_progress",
    });
    assert.equal(err.kind, "in_flight");
    assert.equal(err.retryable, true);
  });

  it("recognises an in-progress 409 from the message when no code is sent", () => {
    const err = errorFromResponse(409, {
      error: "A request with this Idempotency-Key is already being processed. Retry shortly.",
    });
    assert.equal(err.kind, "in_flight");
    assert.equal(err.retryable, true);
  });

  // The outcome is unknown while another attempt holds the lock, so the key has
  // to stay put; rotating it would execute the call a second time.
  it("holds the key on an in-progress duplicate", () => {
    assert.equal(isIndefinite("in_flight"), true);
  });

  it("treats a key conflict as terminal for that key", () => {
    const err = errorFromResponse(409, {
      error: "Idempotency-Key was reused with a different request payload.",
      code: "idempotency_conflict",
    });
    assert.equal(err.retryable, false);
    // Definite, so the next attempt is free to take a fresh key.
    assert.equal(isIndefinite(err.kind), false);
  });
});

describe("settlement", () => {
  const SETTLEMENT_DEPLOYMENT = {
    ...DEPLOYMENT,
    batchSettlement: "0xc319dB6F56B3cdA82d2Bcb2eFA75e5c4993B705f",
  };

  const settle = async (amountRaw: string, orderId = "A,B,C") => {
    const { fetchImpl, calls } = stubFetch([
      // assertWouldSucceed runs first and carries no idempotency key.
      () => ({ status: 200, body: { success: true, gasEstimate: "48000" } }),
      () => ({ status: 202, body: { executionId: "e", status: "pending" } }),
      () => ({ status: 200, body: { executionId: "e", status: "completed" } }),
    ]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    const keeper = new PolarisKeeper(kh, SETTLEMENT_DEPLOYMENT, new InMemoryReceiptStore());
    const receipt = await keeper.settleMerchant({
      merchantId: "m1",
      payoutAddress: "0xPayout",
      amountRaw,
      orderId,
    });
    const keyed = calls
      .map((c) => (c.init.headers as Record<string, string>)["Idempotency-Key"])
      .filter(Boolean);
    return { receipt, calls, key: keyed[0] };
  };

  // The bug this replaces: settlePayment was called on the merchant's payout
  // address, which is an EOA. A call to a codeless address cannot revert, so
  // every settlement "succeeded" while moving nothing.
  it("targets the settlement contract, not the merchant's own address", async () => {
    const { calls } = await settle("100000000");
    const body = calls[0]!.body;
    assert.equal(body.contractAddress, SETTLEMENT_DEPLOYMENT.batchSettlement);
    assert.equal(body.functionName, "settleBatch");
    assert.notEqual(body.contractAddress, "0xPayout");
  });

  it("passes the payout address as a recipient, not a call target", async () => {
    const { calls } = await settle("100000000");
    const args = JSON.parse(calls[0]!.body.functionArgs);
    assert.deepEqual(args[1], ["0xPayout"], "merchants array");
    assert.deepEqual(args[2], ["100000000"], "amounts array");
  });

  // A live run hit this: the same five orders settled twice, the second time
  // for more money because more instalments had collected in between.
  it("gives a larger payout over the same orders a different key and batch", async () => {
    const a = await settle("100000000");
    const b = await settle("250000000");
    assert.notEqual(a.key, b.key, "idempotency key");
    const idA = JSON.parse(a.calls[0]!.body.functionArgs)[0];
    const idB = JSON.parse(b.calls[0]!.body.functionArgs)[0];
    assert.notEqual(idA, idB, "on-chain batch id");
  });

  it("collapses an identical settlement onto one key and one batch id", async () => {
    const a = await settle("100000000");
    const b = await settle("100000000");
    assert.equal(a.key, b.key);
    assert.equal(
      JSON.parse(a.calls[0]!.body.functionArgs)[0],
      JSON.parse(b.calls[0]!.body.functionArgs)[0]
    );
  });

  it("produces a real bytes32 batch id and memo", async () => {
    const { calls } = await settle("100000000");
    const args = JSON.parse(calls[0]!.body.functionArgs);
    for (const [label, v] of [["batchId", args[0]], ["memo", args[3][0]]] as const) {
      assert.match(v, /^0x[0-9a-f]{64}$/, `${label} must be bytes32`);
    }
  });

  // Without a settlement contract there is nowhere to pay from. Failing loudly
  // beats the old behaviour, which was to report success and pay nobody.
  it("fails instead of pretending when no settlement contract is configured", async () => {
    const { fetchImpl } = stubFetch([]);
    const kh = new KeeperHubClient({ apiKey: "kh_test", fetchImpl });
    const keeper = new PolarisKeeper(kh, DEPLOYMENT, new InMemoryReceiptStore());
    const receipt = await keeper.settleMerchant({
      merchantId: "m1",
      payoutAddress: "0xPayout",
      amountRaw: "100000000",
      orderId: "A",
    });
    assert.equal(receipt.outcome, "failed");
    assert.match(receipt.error?.message ?? "", /POLARIS_BATCH_SETTLEMENT/);
  });
});
