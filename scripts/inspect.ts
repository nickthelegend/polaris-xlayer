/**
 * Inspect a borrower's position on chain.
 *
 *   pnpm exec tsx scripts/inspect.ts [address]
 *
 * A repo tool, deliberately independent of the app's chain layer: that layer
 * imports React Native polyfills which do not load under Node, and a
 * diagnostic that can only run inside the thing it is diagnosing is not much
 * of a diagnostic. Reads only — it never signs.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLUSTER = process.env.POLARIS_CLUSTER ?? "localnet";
const seed = JSON.parse(
  readFileSync(resolve(here, `../deployments/${CLUSTER}-seed.json`), "utf8"),
);
const IDL = JSON.parse(
  readFileSync(resolve(here, "../target/idl/polaris.json"), "utf8"),
) as Idl;

const usd = (v: any) => (Number(v.toString()) / 1e6).toFixed(6);

async function main() {
  const connection = new Connection(seed.rpc, "confirmed");
  // A read-only provider still wants a signer shape; nothing here signs.
  const dummy = Keypair.generate();
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: dummy.publicKey,
      signTransaction: async (t: any) => t,
      signAllTransactions: async (t: any) => t,
    } as any,
    { commitment: "confirmed" },
  );
  const program = new Program(IDL, provider);

  const pda = (s: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(s, program.programId)[0];

  const who = new PublicKey(process.argv[2] ?? seed.seededBorrower);
  const protocolPda = pda([Buffer.from("protocol")]);

  const p: any = await (program.account as any).protocol.fetch(protocolPda);
  console.log(
    `protocol  loans ${p.loanCount} · plans ${p.planCount} · fees ${usd(p.protocolFeesAccrued)} · bad debt ${usd(p.badDebt)}`,
  );

  const profilePda = pda([Buffer.from("profile"), who.toBuffer()]);
  const info = await connection.getAccountInfo(profilePda);
  if (!info) {
    console.log(`\n${who.toBase58()}\n  no profile yet — a borrower with no history`);
    return;
  }
  const prof: any = await (program.account as any).creditProfile.fetch(profilePda);
  console.log(`\n${who.toBase58()}`);
  console.log(
    `  score ${prof.score} · on time ${prof.onTimePayments} · late ${prof.latePayments} · liquidations ${prof.liquidations}`,
  );
  console.log(`  debt ${usd(prof.activeDebt)} · collateral ${usd(prof.lockedCollateral)}`);

  const loans = await (program.account as any).loan.all([
    { memcmp: { offset: 8 + 8, bytes: who.toBase58() } },
  ]);
  console.log(`  loans ${loans.length}`);
  for (const l of loans) {
    const a = l.account;
    console.log(
      `    #${a.id} ${Object.keys(a.status)[0].padEnd(11)} ${a.installmentsPaid}/${a.installmentCount}  owed ${usd(a.totalOwed)}  repaid ${usd(a.totalRepaid)}`,
    );
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
