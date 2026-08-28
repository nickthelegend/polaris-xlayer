import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { explainError } from "../src/chain/explain.ts";

/** The exact message web3.js throws when confirmation times out after a send. */
const TIMEOUT =
  "Transaction was not confirmed in 45.00 seconds. It is unknown if it succeeded or failed. " +
  "Check signature 5BgT78MxrNDP2cmPKqLSeogVrcrwuzz4QyqowPn1XrqiCtYWEPMumbDMRK9jsV7uJQBwCuhn5xJTFSiyuHkd53zH " +
  "using the Solana Explorer or CLI tools.";

describe("explainError — never call money safe when it might not be", () => {
  it("does not claim nothing was charged when the outcome is unknown", () => {
    const said = explainError(new Error(TIMEOUT));
    assert.ok(
      !/nothing was charged/i.test(said),
      `a broadcast transaction of unknown outcome must not be called a refusal, got: ${said}`,
    );
    assert.match(said, /may still have gone through/i);
  });

  it("names the signature so the borrower can check it", () => {
    assert.match(explainError(new Error(TIMEOUT)), /5BgT78Mx/);
  });

  it("still reassures when the blockhash expired before the transaction landed", () => {
    // This one genuinely did not land, so "nothing was charged" is true.
    assert.match(
      explainError(new Error("Transaction simulation failed: Blockhash not found")),
      /nothing was charged/i,
    );
  });
});

describe("explainError — a network failure is not a refusal", () => {
  const ANDROID =
    'fetch failed: java.net.UnknownHostException: Unable to resolve host "api.devnet.solana.com": ' +
    "No address associated with hostname";

  it("recognises Android's wording, not just the browser's", () => {
    // Android says "fetch failed"; a browser says "Failed to fetch". Matching
    // only the browser's order announced a refusal for a transaction that
    // never left the phone.
    const said = explainError(new Error(ANDROID));
    assert.match(said, /cannot reach the network/i);
    assert.ok(!/refused/i.test(said), `a DNS failure is not a refusal: ${said}`);
  });

  it("still recognises the browser's wording", () => {
    assert.match(explainError(new TypeError("Failed to fetch")), /cannot reach the network/i);
  });

  it("does not leak the java stack to the screen", () => {
    const said = explainError(new Error(ANDROID));
    assert.ok(!said.includes("java.net"), said);
    assert.ok(said.length < 120, said);
  });
});

describe("explainError — a fee is not a credit limit", () => {
  it("names SOL when the fee payer has never been funded", () => {
    const said = explainError(
      new Error("Transaction simulation failed: Attempt to debit an account but found no record of a prior credit."),
    );
    assert.match(said, /no SOL to pay the network fee/i);
    assert.ok(!/credit line|limit/i.test(said), `this is not about credit: ${said}`);
  });
});

describe("explainError — always a sentence, never a symbol", () => {
  it("maps a known program error to its own words", () => {
    assert.equal(
      explainError(new Error("Simulation failed. Error Code: DebtOutstanding. Error Number: 6001.")),
      "You still owe on a plan. Repay it before withdrawing collateral.",
    );
  });

  it("never puts an unmapped identifier on screen", () => {
    const said = explainError(new Error("Error Code: SomeUnmappedThing. Error Number: 6099."));
    assert.ok(!said.includes("SomeUnmappedThing"), `leaked the symbol: ${said}`);
    assert.match(said, /\s/);
  });

  it("does not put a paragraph of logs on screen", () => {
    const said = explainError(new Error("y".repeat(400)));
    assert.ok(said.length < 200, `too long to be a sentence: ${said.length} chars`);
  });

  it("runs outside the app, where __DEV__ does not exist", () => {
    // Every branch below reached a bare `__DEV__`, which throws rather than
    // reading as false in any host the bundler did not build.
    assert.doesNotThrow(() => explainError(new Error("Error Code: Unmapped.")));
    assert.doesNotThrow(() => explainError(new Error("z".repeat(400))));
  });

  it("survives an error that is not an Error at all", () => {
    for (const junk of [null, undefined, 42, {}, "plain string"]) {
      const said = explainError(junk);
      assert.equal(typeof said, "string");
      assert.ok(said.length > 0);
    }
  });
});
