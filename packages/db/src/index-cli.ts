/** Backfill the audit log from LoanEngine logs. */
import { closeDb } from "./client.js";
import { indexEvents, lastIndexedBlock } from "./indexer.js";

try {
  const chainId = Number(process.env.CHAIN_ID ?? 11_155_111);
  const resume = await lastIndexedBlock(chainId);
  const from = Number(process.env.INDEX_FROM_BLOCK ?? (resume ? resume + 1 : 11_415_000));

  const r = await indexEvents({
    rpc: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    loanEngine: process.env.POLARIS_LOAN_ENGINE ?? "",
    chainId,
    fromBlock: from,
  });

  console.log(`blocks ${r.fromBlock} → ${r.toBlock}`);
  console.log(`  ${r.found} log(s) found, ${r.inserted} newly indexed`);
  if (resume !== null) console.log(`  (resumed from block ${resume})`);
} catch (err) {
  console.error(`Index failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
