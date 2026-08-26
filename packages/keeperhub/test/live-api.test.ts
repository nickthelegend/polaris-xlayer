/**
 * Live integration test against the real KeeperHub API.
 *
 *   node --test --experimental-strip-types test/live-api.test.ts
 *
 * The rest of the suite runs against stubbed transport, which proves the client
 * is internally consistent but not that it speaks the protocol the server
 * actually speaks. These tests hit https://app.keeperhub.com for real.
 *
 * Everything here works without credentials. With no API key the reachable
 * surface is the unauthenticated one -- the x402 resource catalogue and the
 * shape of a rejected request -- so that is what is asserted: that the real
 * server's 401 is classified as `auth` by the real client, and that a bad key
 * fails fast rather than being retried.
 *
 * When KEEPERHUB_API_KEY is present the authenticated checks run too. They are
 * skipped rather than failed when it is absent, so this file is safe in CI.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KeeperHubClient, KeeperHubError, LOAN_ENGINE_ABI } from "../dist/index.js";

const BASE = process.env.KEEPERHUB_BASE_URL ?? "https://app.keeperhub.com";
const API_KEY = process.env.KEEPERHUB_API_KEY;
const hasKey = typeof API_KEY === "string" && API_KEY.startsWith("kh_");

describe("live KeeperHub API - unauthenticated surface", () => {
  it("the x402 catalogue is reachable and advertises paid workflows", async () => {
    const res = await fetch(`${BASE}/.well-known/x402`);
    assert.equal(res.status, 200);

    const body = (await res.json()) as { version: number; resources: string[] };
    assert.equal(body.version, 1);
    assert.ok(Array.isArray(body.resources));
    assert.ok(
      body.resources.length > 0,
      "expected at least one listed workflow in the catalogue"
    );
    assert.ok(
      body.resources.every((r) => r.startsWith("POST /api/mcp/workflows/")),
      "every advertised resource should be a workflow call route"
    );
  });

  it("the MCP endpoint responds", async () => {
    const res = await fetch(`${BASE}/mcp`);
    // 200 or 401 both prove it is live and routing; a 404/5xx would not.
    assert.ok(
      res.status === 200 || res.status === 401,
      `expected 200 or 401 from /mcp, got ${res.status}`
    );
  });

  it("classifies the real server's rejection as an auth failure", async () => {
    // A syntactically valid but unissued key. The point is that the mapping
    // from the live 401 to our typed error holds against the real response
    // body, not a stub of it.
    const client = new KeeperHubClient({
      apiKey: "kh_this_key_was_never_issued_by_keeperhub",
      baseUrl: BASE,
    });

    await assert.rejects(
      () =>
        client.simulateContractCall({
          contractAddress: "0x0000000000000000000000000000000000000000",
          chainId: 11_155_111,
          functionName: "checkLiquidatable",
        }),
      (err: unknown) => {
        assert.ok(err instanceof KeeperHubError, "should be a KeeperHubError");
        assert.equal(err.kind, "auth", `expected kind "auth", got "${err.kind}"`);
        assert.equal(err.status, 401);
        assert.equal(err.retryable, false, "an auth failure must not be retried");
        return true;
      }
    );
  });

  it("does not retry a rejected key, so a bad credential fails fast", async () => {
    let attempts = 0;
    const countingFetch: typeof fetch = async (url, init) => {
      attempts++;
      return await fetch(url as string, init);
    };

    const client = new KeeperHubClient({
      apiKey: "kh_this_key_was_never_issued_by_keeperhub",
      baseUrl: BASE,
      maxRetries: 3,
      fetchImpl: countingFetch,
    });

    await assert.rejects(() =>
      client.simulateContractCall({
        contractAddress: "0x0000000000000000000000000000000000000000",
        chainId: 11_155_111,
        functionName: "checkLiquidatable",
      })
    );
    assert.equal(attempts, 1, `expected exactly 1 request, got ${attempts}`);
  });

  it("rejects a non-kh_ credential before any network call is made", async () => {
    let attempts = 0;
    assert.throws(
      () =>
        new KeeperHubClient({
          apiKey: "sk_wrong_prefix",
          baseUrl: BASE,
          fetchImpl: (async () => {
            attempts++;
            return new Response("{}");
          }) as unknown as typeof fetch,
        }),
      (e: unknown) => e instanceof KeeperHubError && e.kind === "auth"
    );
    assert.equal(attempts, 0, "no request should reach the network");
  });
});

describe("live KeeperHub API - authenticated surface", () => {
  it("simulates a real contract call against the deployed LoanEngine", async (t) => {
    if (!hasKey) {
      t.skip("KEEPERHUB_API_KEY not set");
      return;
    }
    const engine = process.env.POLARIS_LOAN_ENGINE;
    if (!engine) {
      t.skip("POLARIS_LOAN_ENGINE not set");
      return;
    }

    const client = new KeeperHubClient({ apiKey: API_KEY!, baseUrl: BASE });

    // The ABI is passed explicitly. KeeperHub can auto-fetch it for a verified
    // contract, but this deployment is unverified on Etherscan, so omitting it
    // is a 400 on `abi` -- which is the correct server behaviour, not a bug.
    const sim = await client.simulateContractCall({
      contractAddress: engine,
      chainId: 11_155_111,
      functionName: "checkLiquidatable",
      functionArgs: '["1"]',
      abi: LOAN_ENGINE_ABI,
    });

    assert.ok(sim, "simulation should return a result");
    // Loan 1 is fully repaid, so the keeper's condition must read false.
    assert.equal(
      sim.result,
      false,
      "a repaid loan must not be liquidatable"
    );
  });

  it("classifies a missing ABI on an unverified contract as a validation error", async (t) => {
    if (!hasKey) {
      t.skip("KEEPERHUB_API_KEY not set");
      return;
    }
    const engine = process.env.POLARIS_LOAN_ENGINE;
    if (!engine) {
      t.skip("POLARIS_LOAN_ENGINE not set");
      return;
    }

    const client = new KeeperHubClient({ apiKey: API_KEY!, baseUrl: BASE });
    await assert.rejects(
      () =>
        client.simulateContractCall({
          contractAddress: engine,
          chainId: 11_155_111,
          functionName: "checkLiquidatable",
          functionArgs: '["1"]',
        }),
      (err: unknown) => {
        assert.ok(err instanceof KeeperHubError);
        assert.equal(err.kind, "validation");
        assert.equal(err.field, "abi");
        assert.equal(err.retryable, false, "a missing ABI will not fix itself");
        return true;
      }
    );
  });
});
