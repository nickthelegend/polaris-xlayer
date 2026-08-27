/**
 * Fund an address on a test cluster.
 *
 *   pnpm exec tsx scripts/fund.ts <address>
 *
 * The app generates its own signer on the device and never carries a key in
 * this repository, so there is no seeded wallet to hand it. This gives that
 * wallet something to spend: SOL for fees and USDC of the protocol's own
 * stablecoin. It refuses to run against mainnet.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const here = dirname(fileURLToPath(import.meta.url));
const CLUSTER = process.env.POLARIS_CLUSTER ?? "localnet";

if (CLUSTER === "mainnet" || CLUSTER === "mainnet-beta") {
  console.error("Refusing to run against mainnet.");
  process.exit(1);
}

const target = process.argv[2];
if (!target) {
  console.error("Usage: tsx scripts/fund.ts <address>");
  process.exit(1);
}

const seed = JSON.parse(
  readFileSync(resolve(here, `../deployments/${CLUSTER}-seed.json`), "utf8"),
);

function loadAuthority(): Keypair {
  const cfg = resolve(homedir(), ".config/solana/cli/config.yml");
  const path =
    process.env.POLARIS_KEYPAIR ??
    (readFileSync(cfg, "utf8").match(/keypair_path:\s*(.+)/)?.[1].trim() ??
      "~/.config/solana/id.json");
  const p = path.startsWith("~") ? resolve(homedir(), path.slice(2)) : path;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

async function main() {
  const connection = new Connection(seed.rpc, "confirmed");
  const authority = loadAuthority();
  const owner = new PublicKey(target);
  const mint = new PublicKey(seed.stablecoin);

  const ata = getAssociatedTokenAddressSync(mint, owner, true);

  /*
   * Top up to a target rather than sending a fixed two SOL.
   *
   * A local validator airdrops freely, so the flat transfer never mattered
   * there. On devnet the authority is funded by a rate-limited faucet, and a
   * blind 2 SOL transfer from an authority holding 0.07 fails the whole
   * transaction — taking the USDC mint down with it, for a wallet that only
   * needed a few thousand lamports of rent. So: send the difference, send
   * nothing when the wallet is already covered, and never send more than the
   * authority can spare.
   */
  const TARGET = Number(process.env.POLARIS_FUND_SOL ?? 2) * LAMPORTS_PER_SOL;
  const have = await connection.getBalance(owner);
  const authorityHas = await connection.getBalance(authority.publicKey);
  // Whatever is left has to cover this transaction's own fee and the ata rent.
  const spare = Math.max(0, authorityHas - 0.01 * LAMPORTS_PER_SOL);
  const topUp = Math.min(Math.max(0, TARGET - have), spare);

  const ixs: any[] = [];
  if (topUp > 0) {
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: owner,
        lamports: topUp,
      }),
    );
  }
  if (!(await connection.getAccountInfo(ata))) {
    ixs.push(createAssociatedTokenAccountInstruction(authority.publicKey, ata, owner, mint));
  }
  ixs.push(createMintToInstruction(mint, ata, authority.publicKey, 5_000_000_000));

  const tx = new Transaction().add(...ixs);
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(authority);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, "confirmed");

  console.log(`funded ${owner.toBase58()}`);
  console.log(
    topUp > 0
      ? `  ${(topUp / LAMPORTS_PER_SOL).toFixed(4)} SOL and 5,000 USDC`
      : `  5,000 USDC — already had ${(have / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
  );
  console.log(`  ${sig}`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
