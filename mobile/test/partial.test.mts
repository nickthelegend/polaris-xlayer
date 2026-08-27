import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describePartial } from "../src/chain/partial.ts";

describe("describePartial", () => {
  it("names a rate limit", () => {
    assert.equal(
      describePartial(new Error("429 Too Many Requests")),
      "the network is rate limiting us",
    );
  });

  it("names a node that has fallen behind, rather than blaming a rate limit", () => {
    // The exact bug: a 500 "node is behind" was reported as rate limiting.
    assert.equal(describePartial(new Error("node is behind")), "the node is behind");
    assert.equal(describePartial(new Error("Node is unhealthy")), "the node is behind");
  });

  it("names an unreachable network", () => {
    assert.equal(
      describePartial(new Error("Network request failed")),
      "the network could not be reached",
    );
    assert.equal(describePartial(new Error("connect ECONNREFUSED")), "the network could not be reached");
  });

  it("names a timeout", () => {
    assert.equal(describePartial(new Error("request timed out")), "the network took too long to answer");
  });

  it("invents nothing when it does not recognise the failure", () => {
    assert.equal(describePartial(new Error("something odd")), null);
    assert.equal(describePartial(null), null);
    assert.equal(describePartial(undefined), null);
    assert.equal(describePartial({}), null);
  });

  it("never returns a json-rpc envelope", () => {
    const envelope = '{"jsonrpc":"2.0","error":{"code":-32603,"message":"node is behind"}}';
    const got = describePartial(new Error(envelope));
    assert.ok(got && !got.includes("{"), "no envelope may reach the screen");
  });
});
