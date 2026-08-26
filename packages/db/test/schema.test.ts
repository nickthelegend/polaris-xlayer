/**
 * The declarations the data layer's safety rests on.
 *
 * Two writes in this package are idempotent only because a unique index makes
 * them so: the receipt upsert keyed on (actionId, attempt) and the loan upsert
 * keyed on (loanId, chainId). Without the index the upsert is a read-then-write
 * race that inserts a second row, and duplicated receipts corrupt every
 * reconciliation total derived from them. The index list is therefore part of
 * the correctness argument, not deployment trivia.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COLLECTIONS, INDEXES, mongoUri } from "../dist/index.js";

const find = (collection: string, spec: Record<string, 1 | -1>) =>
  INDEXES.find(
    (i) => i.collection === collection && JSON.stringify(i.spec) === JSON.stringify(spec)
  );

describe("index declarations", () => {
  it("makes the receipt upsert key unique", () => {
    // MongoReceiptStore.put upserts on exactly this pair so an interrupted
    // keeper pass can rewrite its receipt instead of duplicating it.
    const idx = find("receipts", { actionId: 1, attempt: 1 });
    assert.ok(idx, "no index on (actionId, attempt)");
    assert.equal(idx.options?.unique, true);
  });

  it("makes the loan identity unique per chain", () => {
    // The checkout route upserts on (loanId, chainId) after the chain has
    // already assigned the id. A duplicate row here is a second book entry for
    // one real loan.
    const idx = find("loans", { loanId: 1, chainId: 1 });
    assert.ok(idx, "no index on (loanId, chainId)");
    assert.equal(idx.options?.unique, true);
  });

  it("keeps merchant identity and api key digests unique", () => {
    for (const spec of [{ merchantId: 1 }, { apiKeyHash: 1 }] as const) {
      const idx = find("merchants", spec);
      assert.ok(idx, `no index on ${JSON.stringify(spec)}`);
      assert.equal(idx.options?.unique, true, `${JSON.stringify(spec)} must be unique`);
    }
  });

  it("serves the keeper's due-instalment query", () => {
    // dueInstallments filters on status plus an elemMatch over installment
    // state and dueAt. Without a compound index leading on status this scans
    // the whole active book on every pass.
    const idx = find("loans", {
      status: 1,
      "installments.state": 1,
      "installments.dueAt": 1,
    });
    assert.ok(idx, "no compound index for the collection query");
  });

  it("declares no index twice", () => {
    const keys = INDEXES.map((i) => `${i.collection}:${JSON.stringify(i.spec)}`);
    assert.equal(new Set(keys).size, keys.length, "duplicate index declaration");
  });

  it("names only collections that exist", () => {
    const known = new Set(Object.values(COLLECTIONS));
    for (const idx of INDEXES) {
      assert.ok(known.has(idx.collection as never), `unknown collection ${idx.collection}`);
    }
  });
});

describe("mongoUri", () => {
  it("returns the configured connection string", () => {
    assert.equal(
      mongoUri({ MONGODB_URI: "mongodb+srv://user:pw@cluster/polarispay" } as NodeJS.ProcessEnv),
      "mongodb+srv://user:pw@cluster/polarispay"
    );
  });

  it("refuses to guess a default", () => {
    // Falling back to localhost would let a misconfigured deployment come up
    // clean and write live loans into an empty local database.
    assert.throws(() => mongoUri({} as NodeJS.ProcessEnv), /MONGODB_URI/);
  });

  it("treats an empty value as missing", () => {
    assert.throws(() => mongoUri({ MONGODB_URI: "" } as NodeJS.ProcessEnv), /MONGODB_URI/);
  });

  it("reads the env it was handed, not the ambient one", () => {
    // The CLIs pass an explicit env; if this silently preferred process.env a
    // script pointed at one cluster could connect to another.
    const saved = process.env.MONGODB_URI;
    process.env.MONGODB_URI = "mongodb://ambient";
    try {
      assert.equal(
        mongoUri({ MONGODB_URI: "mongodb://injected" } as NodeJS.ProcessEnv),
        "mongodb://injected"
      );
    } finally {
      if (saved === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = saved;
    }
  });
});
