import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveInterval } from "./config.ts";

describe("resolveInterval", () => {
  it("defaults to a minute", () => {
    // The protocol's own interval floor is sixty seconds, so waking faster
    // than that can only ever find the same nothing.
    assert.equal(resolveInterval(undefined), 60);
    assert.equal(resolveInterval(""), 60);
    assert.equal(resolveInterval("   "), 60);
  });

  it("takes a sensible value as given", () => {
    assert.equal(resolveInterval("30"), 30);
    assert.equal(resolveInterval("3600"), 3600);
  });

  it("floors at five seconds", () => {
    // A keeper that wakes every second is a denial-of-service against its own
    // RPC, and finds nothing new each time.
    assert.equal(resolveInterval("1"), 5);
    assert.equal(resolveInterval("0"), 5);
    assert.equal(resolveInterval("-100"), 5);
  });

  it("survives a value that is not a number", () => {
    /*
     * The reason this is a function and not a `Math.max` inline.
     *
     * `Math.max(5, Number("every minute"))` is NaN rather than 5, and
     * `setTimeout(NaN)` fires immediately — so a typo in an env var produced
     * precisely the hot loop the floor was written to prevent.
     */
    for (const bad of ["every minute", "60s", "abc", "NaN", "Infinity", "-Infinity"]) {
      const resolved = resolveInterval(bad);
      assert.ok(Number.isFinite(resolved), `${bad} produced ${resolved}`);
      assert.ok(resolved >= 5, `${bad} produced ${resolved}`);
    }
  });

  it("does not return a fraction, which setTimeout would round anyway", () => {
    assert.equal(resolveInterval("12.7"), 12);
  });
});
