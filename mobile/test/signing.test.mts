import assert from "node:assert/strict";
import { describe, it } from "node:test";

/*
 * These run in plain Node, deliberately.
 *
 * `tsc` type-checks the adapter against its `react-native` build while Node
 * executes its `node` build, so anything touching `transact` is NOT covered by
 * a green run here — that boundary is one file away, in `mwaSigner.android.ts`.
 * Everything below is the decision-making that surrounds it, which is where
 * the expensive mistakes live.
 */
import {
  assertSignable,
  chainIdFor,
  classifyMwaError,
  decodeBase64Address,
  explainMwaFailure,
  selectSigner,
  shouldAuthorize,
  whyNoMwa,
} from "../src/chain/signing/pure.ts";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const thirtyTwo = (fill: number) => new Uint8Array(32).fill(fill);

describe("decodeBase64Address", () => {
  it("round-trips a real 32-byte address", () => {
    const bytes = thirtyTwo(7);
    assert.deepEqual(decodeBase64Address(b64(bytes)), bytes);
  });

  it("refuses a base58 address rather than silently decoding it", () => {
    /*
     * The whole reason this function exists. A base58 pubkey handed to a
     * base64 decoder throws most of the time and, the rest of the time, yields
     * a valid 32-byte array for a completely different account — a wrong
     * payer, a wrong token account, and a failure nowhere near the cause.
     *
     * Sweeping a large sample proves neither outcome escapes.
     */
    const base58 = "1234567890abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
    let escaped = 0;
    for (let i = 0; i < 500; i += 1) {
      // 44-character base58-shaped strings, the length a real pubkey has.
      let candidate = "";
      for (let j = 0; j < 44; j += 1) {
        candidate += base58[(i * 7 + j * 13) % base58.length];
      }
      try {
        decodeBase64Address(candidate);
        escaped += 1;
      } catch {
        /* refused, which is the point */
      }
    }
    assert.equal(escaped, 0, "a base58-shaped address must never decode as base64");
  });

  it("refuses the wrong number of bytes", () => {
    assert.throws(() => decodeBase64Address(b64(new Uint8Array(31))), /31-byte/);
    assert.throws(() => decodeBase64Address(b64(new Uint8Array(33))), /33-byte/);
  });

  it("refuses an empty address", () => {
    assert.throws(() => decodeBase64Address(""), /empty/i);
  });

  it("accepts base64url and unpadded output", () => {
    // A wallet is free to emit either; rejecting them would be our bug.
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) bytes[i] = (i * 11 + 251) % 256;

    const standard = b64(bytes);
    const url = standard.replace(/\+/g, "-").replace(/\//g, "_");
    const unpadded = standard.replace(/=+$/, "");

    assert.deepEqual(decodeBase64Address(url), bytes);
    assert.deepEqual(decodeBase64Address(unpadded), bytes);
  });
});

describe("chainIdFor", () => {
  it("maps the public clusters", () => {
    assert.equal(chainIdFor("mainnet-beta"), "solana:mainnet");
    assert.equal(chainIdFor("devnet"), "solana:devnet");
    assert.equal(chainIdFor("testnet"), "solana:testnet");
  });

  it("returns null for localnet, which no wallet can reach", () => {
    // A phone cannot open the host's loopback address. Returning null is what
    // stops the app offering a connection that could only ever fail.
    assert.equal(chainIdFor("localnet"), null);
    assert.equal(chainIdFor("anything-else"), null);
  });
});

describe("selectSigner", () => {
  const base = { os: "android", mwaAvailable: true, chainId: "solana:devnet" as const };

  it("uses a wallet app only when everything lines up", () => {
    assert.equal(selectSigner(base), "mwa");
  });

  it("falls back off Android, in Expo Go, and on localnet", () => {
    assert.equal(selectSigner({ ...base, os: "web" }), "device");
    assert.equal(selectSigner({ ...base, os: "ios" }), "device");
    assert.equal(selectSigner({ ...base, mwaAvailable: false }), "device");
    assert.equal(selectSigner({ ...base, chainId: null }), "device");
  });

  it("explains itself in each of those cases", () => {
    assert.equal(whyNoMwa(base), null);
    assert.match(whyNoMwa({ ...base, os: "web" })!, /Android build/);
    assert.match(whyNoMwa({ ...base, mwaAvailable: false })!, /development build/);
    assert.match(whyNoMwa({ ...base, chainId: null })!, /local validator/);
  });
});

describe("classifyMwaError", () => {
  it("reads the protocol's numeric codes", () => {
    assert.deepEqual(classifyMwaError({ code: -1 }), { kind: "stale-auth" });
    assert.deepEqual(classifyMwaError({ code: -3 }), { kind: "declined" });
    assert.deepEqual(classifyMwaError({ code: -4 }), { kind: "not-submitted" });
  });

  it("treats every other numeric code as unknown rather than guessing", () => {
    for (const code of [-2, -5, -100, -999]) {
      assert.equal(classifyMwaError({ code, message: "x" }).kind, "unknown");
    }
  });

  it("spots a missing wallet app", () => {
    assert.deepEqual(classifyMwaError({ code: "ERROR_WALLET_NOT_FOUND" }), { kind: "no-wallet" });
  });

  it("treats a cancelled chooser as cancelled, not as a fault", () => {
    // The native module has no code for this — it puts the sentence in `code`.
    const thrown = { code: "Session not established: Local association cancelled by user" };
    assert.deepEqual(classifyMwaError(thrown), { kind: "cancelled" });
    assert.deepEqual(classifyMwaError({ code: "ERROR_SESSION_CLOSED" }), { kind: "cancelled" });
  });

  it("survives being handed something that is not an error at all", () => {
    assert.equal(classifyMwaError(undefined).kind, "unknown");
    assert.equal(classifyMwaError("a string").kind, "unknown");
    assert.equal(classifyMwaError(null).kind, "unknown");
  });

  it("has a readable sentence for every kind", () => {
    const kinds = [
      { kind: "no-wallet" }, { kind: "declined" }, { kind: "stale-auth" },
      { kind: "not-submitted" }, { kind: "cancelled" }, { kind: "unsupported" },
      { kind: "unknown", message: "boom" },
    ] as const;
    for (const k of kinds) {
      const sentence = explainMwaFailure(k);
      assert.ok(sentence.length > 0, `${k.kind} has no sentence`);
      assert.ok(!/undefined|\[object/.test(sentence), `${k.kind} leaked a raw value`);
    }
  });
});

describe("assertSignable", () => {
  it("refuses a transaction no wallet could serialize", () => {
    assert.throws(() => assertSignable({ recentBlockhash: "abc" }), /fee payer/);
    assert.throws(() => assertSignable({ feePayer: {} }), /blockhash/);
  });

  it("accepts a compiled legacy transaction", () => {
    assert.doesNotThrow(() => assertSignable({ feePayer: {}, recentBlockhash: "abc" }));
  });

  it("lets a versioned transaction through — it carries both in its message", () => {
    assert.doesNotThrow(() => assertSignable({ version: 0 }));
  });
});

describe("shouldAuthorize", () => {
  it("authorizes when there is nothing cached", () => {
    assert.equal(shouldAuthorize(null, "solana:devnet"), "authorize");
  });

  it("reauthorizes with a cached token for the same chain", () => {
    assert.equal(
      shouldAuthorize({ token: "t", chainId: "solana:devnet" }, "solana:devnet"),
      "reauthorize",
    );
  });

  it("authorizes afresh when the chain has changed under the token", () => {
    // Reauthorizing would silently keep the old chain: against a legacy-protocol
    // wallet, `authorize` with a token drops every parameter but the token.
    assert.equal(
      shouldAuthorize({ token: "t", chainId: "solana:mainnet" }, "solana:devnet"),
      "authorize",
    );
  });
});
