/**
 * These tests need a Solana validator with the Polaris program deployed on it,
 * and this repository ships an X Layer product.
 *
 * `pnpm test` here used to fail with `IncorrectProgramId` from the SPL token
 * program: the suite drives an Anchor program that is not deployed on whatever
 * validator happens to be listening. A test command that always fails teaches
 * everyone to ignore it, which is worse than one that says why it did not run.
 *
 * Checking the port is not enough — a validator can be up with no program on
 * it, which is exactly the state that produced the original failure. So this
 * asks the cluster whether the program account actually exists.
 *
 * `pnpm --filter @polaris/gateway test:solana` runs them regardless.
 */
const PROGRAM_ID = "CpRqbMywzAEKkEALZtrXqPYM36E5RrFewYnRtUYEEvUS";
const RPC = process.env.POLARIS_RPC_URL ?? "http://127.0.0.1:8899";

function skip(why) {
  console.log(
    `Skipping the Solana gateway tests: ${why}.\n` +
    "apps/gateway is the Solana Pay service from the earlier port and is not part\n" +
    "of the X Layer product. Bring up a validator with the Polaris program and run\n" +
    "`pnpm --filter @polaris/gateway test:solana` to exercise it."
  );
  process.exit(0);
}

let deployed = false;
try {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "getAccountInfo",
      params: [PROGRAM_ID, { encoding: "base64" }],
    }),
    signal: AbortSignal.timeout(2500),
  });
  const body = await res.json();
  deployed = Boolean(body?.result?.value);
} catch {
  skip(`no Solana cluster answered at ${RPC}`);
}

if (!deployed) skip(`the Polaris program is not deployed on ${RPC}`);

const { spawnSync } = await import("node:child_process");
const r = spawnSync("node", ["--experimental-strip-types", "--test", "test/*.test.ts"], {
  stdio: "inherit",
  shell: true,
});
process.exit(r.status ?? 1);
