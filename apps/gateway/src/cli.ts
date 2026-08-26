/**
 * Underwrite a wallet from the command line.
 *
 *   pnpm --filter @polaris/gateway exec node --experimental-strip-types src/cli.ts <address>
 *
 * With no address it generates one, which is the honest way to see what a
 * wallet with no history is actually worth.
 */
import { Keypair, PublicKey } from "@solana/web3.js";

import { CLUSTER, connect } from "./chain.ts";
import { readEvidence } from "./evidence.ts";
import { explain, formatUnits, scoreFrom } from "./score.ts";
import { underwrite } from "./underwrite.ts";

async function main() {
  const args = process.argv.slice(2);
  const readOnly = args.includes("--read");
  const arg = args.find((a) => !a.startsWith("--"));
  const borrower = arg ? new PublicKey(arg) : Keypair.generate().publicKey;

  /*
   * --read answers "what would this wallet get" without signing anything.
   * Useful against a cluster whose deployed program predates underwriting, and
   * useful to a borrower who wants to see the decision before it is recorded.
   */
  if (readOnly) {
    const c = connect();
    const flag = args.find((a) => a.startsWith("--mint="))?.slice("--mint=".length);
    /*
     * The mint normally comes from the protocol account. A cluster running a
     * build that predates underwriting cannot be decoded by this IDL, and the
     * right answer there is to say so and take the mint directly rather than
     * to quietly assume one -- the balance is a scored input.
     */
    let mint: PublicKey;
    if (flag) {
      mint = new PublicKey(flag);
    } else {
      try {
        const protocol: any = await c.program.account.protocol.fetch(
          c.pda([Buffer.from("protocol")])
        );
        mint = new PublicKey(protocol.stablecoin);
      } catch {
        console.error(
          `Could not read the protocol account on ${CLUSTER}. If that cluster runs a build\n` +
            "older than underwriting, its layout will not decode here. Pass the stablecoin\n" +
            "directly:  --mint=<address>"
        );
        process.exit(1);
      }
    }
    const evidence = await readEvidence(c.connection, borrower, mint);
    const band = scoreFrom(evidence);
    console.log(`cluster    ${CLUSTER}`);
    console.log(`borrower   ${borrower.toBase58()}`);
    console.log("line       not opened — read only");
    console.log(`score      ${band.score}`);
    console.log(`limit      ${formatUnits(band.limit)} USDC`);
    console.log("");
    console.log("read off the chain:");
    for (const reason of explain(evidence, band)) console.log(`  ${reason}`);
    return;
  }

  const r = await underwrite(borrower);

  console.log(`cluster    ${CLUSTER}`);
  console.log(`borrower   ${r.borrower}`);
  console.log(r.alreadyOpen ? "line       already open — left as it was" : "line       opened");
  console.log(`score      ${r.score}`);
  console.log(`limit      ${r.creditLimit} USDC`);
  console.log("");
  console.log("read off the chain:");
  for (const reason of r.reasons) console.log(`  ${reason}`);
  if (r.signature) console.log(`\nsignature  ${r.signature}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
