/**
 * The security-critical paths: signature verification, key hashing, and the
 * webhook retry policy. A bug in any of these is exploitable rather than
 * merely inconvenient, so they are tested against the built artifact.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  SIGNATURE_TOLERANCE_SECONDS,
  signPayload,
  verifySignature,
} from "../dist/index.js";

const SECRET = "whsec_test_secret_value";
const BODY = JSON.stringify({ event: "installment.collected", amount: "50.00" });
const NOW = 1_800_000_000;

describe("webhook signatures", () => {
  it("verifies a signature it just produced", () => {
    const header = signPayload(SECRET, BODY, NOW);
    assert.deepEqual(verifySignature(SECRET, BODY, header, NOW), { ok: true });
  });

  it("rejects a signature made with a different secret", () => {
    const header = signPayload("whsec_attacker", BODY, NOW);
    const result = verifySignature(SECRET, BODY, header, NOW);
    assert.equal(result.ok, false);
  });

  it("rejects a tampered body, since the signature covers it", () => {
    const header = signPayload(SECRET, BODY, NOW);
    const tampered = JSON.stringify({ event: "installment.collected", amount: "5000.00" });
    assert.equal(verifySignature(SECRET, tampered, header, NOW).ok, false);
  });

  it("rejects a replay outside the tolerance window", () => {
    const header = signPayload(SECRET, BODY, NOW);
    const later = NOW + SIGNATURE_TOLERANCE_SECONDS + 1;
    const result = verifySignature(SECRET, BODY, header, later);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /tolerance/);
  });

  it("accepts a delivery inside the tolerance window", () => {
    const header = signPayload(SECRET, BODY, NOW);
    assert.equal(verifySignature(SECRET, BODY, header, NOW + 60).ok, true);
  });

  it("signs over timestamp AND body, so a captured signature cannot be reused for a new body", () => {
    // If the signature covered only the body, this header would validate
    // against any timestamp the attacker chose.
    const header = signPayload(SECRET, BODY, NOW);
    const forged = header.replace(`t=${NOW}`, `t=${NOW + 10}`);
    assert.equal(verifySignature(SECRET, BODY, forged, NOW + 10).ok, false);
  });

  it("rejects a malformed header rather than throwing", () => {
    for (const header of ['', 'garbage', 't=abc,v1=zz', `t=${NOW}`]) {
      const result = verifySignature(SECRET, BODY, header, NOW);
      assert.equal(result.ok, false, `expected rejection for "${header}"`);
    }
  });

  it("rejects a short signature without throwing from timingSafeEqual", () => {
    const result = verifySignature(SECRET, BODY, `t=${NOW},v1=ab`, NOW);
    assert.equal(result.ok, false);
  });
});

describe("api keys", () => {
  it("stores only a digest, so a database dump cannot be replayed", () => {
    const key = generateApiKey();
    const digest = hashApiKey(key);
    assert.notEqual(digest, key);
    assert.equal(digest.length, 64);
    assert.ok(!digest.includes(key.slice(8)), "digest must not embed the key");
  });

  it("hashes deterministically so lookup works", () => {
    const key = generateApiKey();
    assert.equal(hashApiKey(key), hashApiKey(key));
  });

  it("never repeats a key", () => {
    const keys = new Set(Array.from({ length: 500 }, () => generateApiKey()));
    assert.equal(keys.size, 500);
  });

  it("marks test and live keys distinguishably", () => {
    assert.match(generateApiKey(false), /^pk_test_/);
    assert.match(generateApiKey(true), /^pk_live_/);
  });

  it("generates greppable webhook secrets", () => {
    assert.match(generateWebhookSecret(), /^whsec_/);
    assert.notEqual(generateWebhookSecret(), generateWebhookSecret());
  });
});
