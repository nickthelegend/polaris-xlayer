import { defineConfig } from "@playwright/test"

/**
 * The browser regression suite.
 *
 * It drives the deployed app with a wallet that really signs, so it is slow,
 * it costs testnet gas, and it depends on X Layer being up. That is the point
 * — it is the only check that exercises the path the product exists for — but
 * it is why it is not wired into `pnpm test`.
 */
export default defineConfig({
  testDir: "./e2e",
  // Each test signs transactions and waits on a public L2.
  timeout: 240_000,
  expect: { timeout: 30_000 },
  // Serial: the specs share one wallet, and concurrent sends would collide on
  // the nonce.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    headless: true,
    actionTimeout: 30_000,
    trace: "retain-on-failure",
  },
})
