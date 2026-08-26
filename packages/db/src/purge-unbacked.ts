/**
 * Remove loans that no chain has ever heard of.
 *
 *   node --experimental-strip-types src/purge-unbacked.ts
 *
 * Seeded demo rows are useful before a deployment exists and actively harmful
 * after one: they collide with real loan ids, and they put fabricated figures
 * next to real ones in the same ledger. This deletes every loan whose id is
 * above the LoanEngine's `loanCount`, leaving only rows the chain backs.
 *
 * Run after `db:sync` so the surviving rows are already reconciled.
 */

import { closeDb, collections } from "./client.js";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11_155_111);
const ENGINE = process.env.POLARIS_LOAN_ENGINE;
const SEL_LOAN_COUNT = "0xce63094d";

if (!ENGINE) {
  console.error("POLARIS_LOAN_ENGINE is not set.");
  process.exit(1);
}

try {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: ENGINE, data: SEL_LOAN_COUNT }, "latest"],
    }),
  });
  const json = (await res.json()) as { result?: string };
  const onChainCount = BigInt(json.result && json.result !== "0x" ? json.result : "0x0");

  const { loans, receipts } = await collections();
  const all = await loans.find({ chainId: CHAIN_ID }).toArray();

  const unbacked = all.filter((l) => {
    const id = Number(l.loanId);
    return !Number.isFinite(id) || id < 1 || BigInt(id) > onChainCount;
  });

  console.log(`LoanEngine reports ${onChainCount} loan(s) on chain.`);
  console.log(`Book holds ${all.length} row(s) for chain ${CHAIN_ID}.`);

  if (unbacked.length === 0) {
    console.log("\nEvery row is backed by the chain. Nothing to purge.");
  } else {
    for (const l of unbacked) {
      console.log(`  removing loan ${l.loanId} (${l.orderId}) -- no on-chain counterpart`);
      await receipts.deleteMany({ loanId: l.loanId });
    }
    const ids = unbacked.map((l) => l.loanId);
    const result = await loans.deleteMany({ chainId: CHAIN_ID, loanId: { $in: ids } });
    console.log(`\nRemoved ${result.deletedCount} unbacked loan(s).`);
  }

  const remaining = await loans.countDocuments({ chainId: CHAIN_ID });
  console.log(`${remaining} loan(s) remain, all chain-backed.`);
} catch (err) {
  console.error(`Purge failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
