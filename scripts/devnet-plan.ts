/**
 * Put a subscription plan on a deployment.
 *
 * `prove.ts` opens a credit line and an installment plan, which covers two of
 * the three payment modes. Subscriptions had no equivalent, so a public
 * deployment showed `plans 0` and the app's subscribe tab had nothing to
 * offer — the mode was real in the tests and invisible on the cluster.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLUSTER = process.env.POLARIS_CLUSTER ?? "devnet";
const RPC =
  process.env.POLARIS_RPC_URL ??
  (CLUSTER === "localnet" ? "http://127.0.0.1:8899" : `https://api.${CLUSTER}.solana.com`);

const IDL = JSON.parse(readFileSync(resolve(here, "../target/idl/polaris.json"), "utf8")) as Idl;

function loadKeypair(): Keypair {
  const cfg = resolve(homedir(), ".config/solana/cli/config.yml");
  const path =
    process.env.POLARIS_KEYPAIR ??
    readFileSync(cfg, "utf8").match(/keypair_path:\s*(.+)/)![1].trim();
  const p = path.startsWith("~") ? resolve(homedir(), path.slice(2)) : path;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const me = loadKeypair();
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: me.publicKey,
      signTransaction: async (t: any) => (t.partialSign(me), t),
      signAllTransactions: async (ts: any[]) => ts.map((t) => (t.partialSign(me), t)),
    } as any,
    { commitment: "confirmed" },
  );
  const program = new Program(IDL, provider);
  const pda = (s: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(s, program.programId)[0];
  const u64 = (n: number) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };

  const protocolPda = pda([Buffer.from("protocol")]);
  const merchantPda = pda([Buffer.from("merchant"), me.publicKey.toBuffer()]);
  const proto: any = await (program.account as any).protocol.fetch(protocolPda);
  const planId = Number(proto.planCount.toString());
  const planPda = pda([Buffer.from("plan"), u64(planId)]);

  const price = Number(process.env.PRICE ?? 9_000_000);
  const period = Number(process.env.PERIOD ?? 30 * 86_400);
  const name = process.env.NAME ?? "Proof Monthly";

  const signature = await program.methods
    .createPlan(new BN(price), new BN(period), name)
    .accountsPartial({
      authority: me.publicKey,
      protocol: protocolPda,
      merchant: merchantPda,
      plan: planPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const plan: any = await (program.account as any).plan.fetch(planPda);
  console.log(`cluster   ${CLUSTER}`);
  console.log(`plan #${planId}  ${name}`);
  console.log(`  ${(Number(plan.pricePerPeriod) / 1e6).toFixed(2)} USDC every ${Number(plan.periodSeconds) / 86_400} days`);
  console.log(`  ${planPda.toBase58()}`);
  console.log(`  ${signature}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
