import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractRequest, peekRequest, stashRequest, takeRequest } from "../src/chain/incomingRequest.ts";

const INNER =
  "http://localhost:4100/pay/and-9002?merchant=CRe8TKs9yRLuacC2pnVs52KGPL69tW4TVSAvH5A11nEh" +
  "&amount=6000000&mode=later&installments=4&interval=60";

describe("extractRequest", () => {
  it("takes a solana: url as the whole data uri", () => {
    const link = "solana:" + encodeURIComponent(INNER);
    assert.equal(extractRequest(link), "solana:" + INNER);
  });

  it("keeps every query parameter, not just the first", () => {
    const got = extractRequest("solana:" + encodeURIComponent(INNER));
    // The bug this file exists for: the link arrived cut off at the first `&`.
    assert.match(got!, /installments=4/);
    assert.match(got!, /interval=60/);
  });

  it("reads our own scheme, singly encoded", () => {
    const link = "polaris://scan?request=" + encodeURIComponent("solana:" + encodeURIComponent(INNER));
    assert.equal(extractRequest(link), "solana:" + INNER);
  });

  it("reads our own scheme when the platform already decoded a layer", () => {
    // What Android's router actually hands back.
    const link = "polaris://scan?request=" + encodeURIComponent("solana:" + INNER);
    assert.equal(extractRequest(link), "solana:" + INNER);
  });

  it("is idempotent on an already-plain url", () => {
    const plain = "solana:" + INNER;
    assert.equal(extractRequest(plain), plain);
    assert.equal(extractRequest(extractRequest(plain)!), plain);
  });

  it("recovers a request the router rewrote into our own scheme", () => {
    // Exactly what lands after the router mangles `solana:<encoded>`: the
    // scheme is replaced and the payload is left doubly encoded.
    const mangled = "polaris://" + encodeURIComponent(encodeURIComponent(INNER));
    const got = extractRequest(mangled);
    assert.equal(got, "solana:" + INNER);
    assert.match(got!, /interval=60/, "the tail must survive too");
  });

  it("leaves ordinary routes alone", () => {
    assert.equal(extractRequest("polaris://scan"), null);
    assert.equal(extractRequest("polaris://(tabs)/plans"), null);
  });

  it("returns null for a link carrying no request", () => {
    assert.equal(extractRequest("polaris://scan"), null);
    assert.equal(extractRequest("polaris://scan?other=1"), null);
    assert.equal(extractRequest(""), null);
    assert.equal(extractRequest("   "), null);
  });

  it("returns null for a bare transfer request rather than guessing", () => {
    // solana:<address> is a different thing, and must not reach the fetcher.
    assert.equal(extractRequest("solana:CRe8TKs9yRLuacC2pnVs52KGPL69tW4TVSAvH5A11nEh"), null);
  });

  it("survives a malformed escape instead of throwing", () => {
    assert.equal(extractRequest("polaris://scan?request=%E0%A4%A"), null);
  });
});

describe("the pending slot", () => {
  it("hands back what was stashed, once", () => {
    stashRequest("solana:" + INNER);
    assert.equal(takeRequest(), "solana:" + INNER);
    assert.equal(takeRequest(), null, "a remount must not re-open a handled payment");
  });

  it("can be looked at without being consumed", () => {
    stashRequest("solana:http://a.test/1");
    assert.equal(peekRequest(), "solana:http://a.test/1");
    assert.equal(peekRequest(), "solana:http://a.test/1", "peeking must not consume");
    assert.equal(takeRequest(), "solana:http://a.test/1");
    assert.equal(peekRequest(), null);
  });

  it("keeps only the newest code", () => {
    stashRequest("solana:http://a.test/1");
    stashRequest("solana:http://b.test/2");
    assert.equal(takeRequest(), "solana:http://b.test/2");
  });
});
