/**
 * Mongo connection.
 *
 * A single cached client per process. Next.js route handlers and the keeper
 * both import this, and both are hot-reloaded or long-lived, so reconnecting
 * per call would exhaust the Atlas connection pool quickly.
 */

import { MongoClient, type Db, type Collection } from "mongodb";

import {
  COLLECTIONS,
  INDEXES,
  type EventDoc,
  type LoanDoc,
  type MerchantDoc,
  type ReceiptDoc,
} from "./schema.js";

let cached: { client: MongoClient; db: Db } | undefined;

export function mongoUri(env: NodeJS.ProcessEnv = process.env): string {
  const uri = env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env at the repo root and fill it in."
    );
  }
  return uri;
}

export async function getDb(env: NodeJS.ProcessEnv = process.env): Promise<Db> {
  if (cached) {
    return cached.db;
  }
  const client = new MongoClient(mongoUri(env), {
    // Fail fast rather than hanging a checkout request for 30s on a bad network.
    serverSelectionTimeoutMS: 8000,
    retryWrites: true,
  });
  await client.connect();
  const db = client.db(env.MONGODB_DB ?? "polarispay");
  cached = { client, db };
  return db;
}

export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.client.close();
    cached = undefined;
  }
}

export async function collections(env?: NodeJS.ProcessEnv): Promise<{
  merchants: Collection<MerchantDoc>;
  loans: Collection<LoanDoc>;
  receipts: Collection<ReceiptDoc>;
  events: Collection<EventDoc>;
}> {
  const db = await getDb(env);
  return {
    merchants: db.collection<MerchantDoc>(COLLECTIONS.merchants),
    loans: db.collection<LoanDoc>(COLLECTIONS.loans),
    receipts: db.collection<ReceiptDoc>(COLLECTIONS.receipts),
    events: db.collection<EventDoc>(COLLECTIONS.events),
  };
}

/** Create every declared index. Idempotent -- safe to run on every boot. */
export async function ensureIndexes(env?: NodeJS.ProcessEnv): Promise<string[]> {
  const db = await getDb(env);
  const created: string[] = [];
  for (const idx of INDEXES) {
    const name = await db
      .collection(idx.collection)
      .createIndex(idx.spec, idx.options ?? {});
    created.push(`${idx.collection}.${name}`);
  }
  return created;
}

/** Connectivity probe used by `doctor` and the API health check. */
export async function ping(env?: NodeJS.ProcessEnv): Promise<{ ok: boolean; ms: number }> {
  const started = Date.now();
  const db = await getDb(env);
  await db.command({ ping: 1 });
  return { ok: true, ms: Date.now() - started };
}
