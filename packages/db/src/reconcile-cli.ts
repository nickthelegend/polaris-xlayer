/** Read-only drift report between the chain and the book. */
import { closeDb } from "./client.js";
import { materialExposure, reconcile } from "./reconcile.js";
import { formatUnits } from "./loanbook.js";

try {
  const report = await reconcile({
    rpc: process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    loanEngine: process.env.POLARIS_LOAN_ENGINE ?? "",
    // Default to X Layer, not Sepolia. These read `CHAIN_ID` and fell back to
    // 11_155_111 — a chain these contracts were never deployed to — so a missing
    // env var did not fail, it quietly answered about the wrong network. The
    // underscores kept it out of every grep for "11155111" too.
    chainId: Number(process.env.CHAIN_ID ?? 1952),
  });

  console.log(`chain: ${report.chainLoans} loan(s)   book: ${report.bookLoans} row(s)   checked: ${report.checked}`);
  if (report.clean) {
    console.log("\nNo drift. The book agrees with the chain on every loan.");
  } else {
    console.log(`\n${report.drift.length} disagreement(s):`);
    for (const d of report.drift) {
      console.log(`  loan ${d.loanId}  ${d.field}: chain=${d.chain}  book=${d.book}`);
    }
    const exposure = materialExposure(report);
    if (exposure > 0n) {
      console.log(`\nMaterial exposure: ${formatUnits(exposure, 6)} in disputed value.`);
    }
  }
  process.exitCode = report.clean ? 0 : 1;
} catch (err) {
  console.error(`Reconcile failed: ${(err as Error).message}`);
  process.exitCode = 2;
} finally {
  await closeDb();
}
