import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readDelegation } from "../src/chain/delegation.ts";

const PROTOCOL = new Uint8Array(32).fill(7);
const SOMEONE_ELSE = new Uint8Array(32).fill(9);
const USDC = 1_000_000;

/**
 * A real SPL token account, byte for byte:
 *   mint(32) owner(32) amount(8) delegateOption(4) delegate(32) state(1)
 *   isNativeOption(4) isNative(8) delegatedAmount(8) closeAuthority(4+32)
 */
function tokenAccount(opts: { delegate?: Uint8Array; delegated?: number }): Uint8Array {
  const data = new Uint8Array(165);
  const view = new DataView(data.buffer);
  if (opts.delegate) {
    view.setUint32(72, 1, true);
    data.set(opts.delegate, 76);
    view.setBigUint64(121, BigInt(opts.delegated ?? 0), true);
  }
  return data;
}

describe("readDelegation", () => {
  it("N15 — an allowance that covers the debt says nothing", () => {
    const d = readDelegation(
      tokenAccount({ delegate: PROTOCOL, delegated: 42 * USDC }),
      42 * USDC,
      PROTOCOL,
    );
    assert.equal(d.toProtocol, true);
    assert.equal(d.shortfall, 0, "no shortfall means no warning is shown");
  });

  it("N14 — a short allowance reports the real figures", () => {
    const d = readDelegation(
      tokenAccount({ delegate: PROTOCOL, delegated: 10 * USDC }),
      40_310_000,
      PROTOCOL,
    );
    assert.equal(d.toProtocol, true);
    assert.equal(d.remaining, 10 * USDC);
    assert.equal(d.owed, 40_310_000);
    assert.equal(d.shortfall, 30_310_000, "covered for 10.00, owe 40.31, short by 30.31");
  });

  it("N13 — a revoked delegate reads as revoked, not as short", () => {
    const d = readDelegation(tokenAccount({}), 40 * USDC, PROTOCOL);
    assert.equal(d.toProtocol, false, "false is what selects the 'revoked' wording");
    assert.equal(d.remaining, 0);
    assert.equal(d.shortfall, 40 * USDC);
  });

  it("N13 — an allowance pointed at somebody else is revoked, not short", () => {
    // "Top it up" is the wrong advice when the delegate is another program.
    const d = readDelegation(
      tokenAccount({ delegate: SOMEONE_ELSE, delegated: 999 * USDC }),
      40 * USDC,
      PROTOCOL,
    );
    assert.equal(d.toProtocol, false);
    assert.equal(d.remaining, 0, "somebody else's allowance is not ours to count");
  });

  it("N16 — a borrower who owes nothing is never warned", () => {
    const revoked = readDelegation(tokenAccount({}), 0, PROTOCOL);
    assert.equal(revoked.shortfall, 0, "a revoked delegate against no debt is not news");
    const short = readDelegation(
      tokenAccount({ delegate: PROTOCOL, delegated: 0 }),
      0,
      PROTOCOL,
    );
    assert.equal(short.shortfall, 0);
  });

  it("an exactly-covering allowance is not short by a rounding error", () => {
    const d = readDelegation(
      tokenAccount({ delegate: PROTOCOL, delegated: 42_000_031 }),
      42_000_031,
      PROTOCOL,
    );
    assert.equal(d.shortfall, 0);
  });

  it("one base unit short is still short", () => {
    const d = readDelegation(
      tokenAccount({ delegate: PROTOCOL, delegated: 42_000_030 }),
      42_000_031,
      PROTOCOL,
    );
    assert.equal(d.shortfall, 1);
  });

  it("a missing account warns rather than reassures", () => {
    const d = readDelegation(null, 40 * USDC, PROTOCOL);
    assert.equal(d.toProtocol, false);
    assert.equal(d.shortfall, 40 * USDC);
  });

  it("a truncated account is not decoded past its end", () => {
    const short = tokenAccount({ delegate: PROTOCOL, delegated: 99 * USDC }).subarray(0, 120);
    const d = readDelegation(short, 40 * USDC, PROTOCOL);
    assert.equal(d.toProtocol, false, "a short read must not become a confident number");
    assert.equal(d.shortfall, 40 * USDC);
  });

  it("reads a large allowance without losing precision", () => {
    const big = 9_000_000_000_000;
    const d = readDelegation(
      tokenAccount({ delegate: PROTOCOL, delegated: big }),
      big,
      PROTOCOL,
    );
    assert.equal(d.remaining, big);
    assert.equal(d.shortfall, 0);
  });
});
