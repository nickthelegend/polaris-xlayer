/**
 * Create every collection index. Idempotent.
 *
 *   node --experimental-strip-types src/migrate.ts
 */

import { closeDb, ensureIndexes, ping } from "./client.js";

const started = Date.now();

try {
  const health = await ping();
  console.log(`Connected to MongoDB in ${health.ms}ms`);

  const created = await ensureIndexes();
  console.log(`\nEnsured ${created.length} indexes:`);
  for (const name of created) {
    console.log(`  ${name}`);
  }
  console.log(`\nDone in ${Date.now() - started}ms`);
} catch (err) {
  console.error(`Migration failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
