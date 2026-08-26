import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorProvider, Program } from "@coral-xyz/anchor";

// Anchor generates this from the IDL at build time. Using it rather than the
// bare `Idl` is what makes `program.account.creditProfile` a real type instead
// of an index signature the compiler cannot check.
import type { Polaris } from "../../../target/types/polaris.ts";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

export const CLUSTER = process.env.POLARIS_CLUSTER ?? "localnet";

function endpoint(): string {
  if (process.env.POLARIS_RPC_URL) return process.env.POLARIS_RPC_URL;
  const seedPath = resolve(root, `deployments/${CLUSTER}-seed.json`);
  if (existsSync(seedPath)) {
    const seed = JSON.parse(readFileSync(seedPath, "utf8"));
    if (seed.rpc) return seed.rpc as string;
  }
  return CLUSTER === "localnet" ? "http://127.0.0.1:8899" : `https://api.${CLUSTER}.solana.com`;
}

/**
 * The underwriter's key.
 *
 * Read from the Solana CLI config by default, which is the same key that
 * deployed and therefore the same key `initialize` set as the underwriter. A
 * deployment that has rotated the role points POLARIS_UNDERWRITER_KEYPAIR at
 * the service key instead. Nothing is ever read from the repository.
 */
export function loadUnderwriter(): Keypair {
  const explicit = process.env.POLARIS_UNDERWRITER_KEYPAIR;
  const cfg = resolve(homedir(), ".config/solana/cli/config.yml");
  const path =
    explicit ??
    (existsSync(cfg)
      ? readFileSync(cfg, "utf8").match(/keypair_path:\s*(.+)/)?.[1]?.trim()
      : undefined);
  if (!path || !existsSync(path)) {
    throw new Error(
      "No underwriter key. Set POLARIS_UNDERWRITER_KEYPAIR to a keypair file, or configure the Solana CLI."
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

class KeypairWallet {
  // Not a parameter property: this runs under `node --experimental-strip-types`,
  // which rejects them outright.
  payer: Keypair;
  constructor(payer: Keypair) {
    this.payer = payer;
  }
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction(tx: any) {
    tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions(txs: any[]) {
    return Promise.all(txs.map((t) => this.signTransaction(t)));
  }
}

export type Chain = {
  connection: Connection;
  program: Program<Polaris>;
  underwriter: Keypair;
  pda: (seeds: (Buffer | Uint8Array)[]) => PublicKey;
};

export function connect(signer?: Keypair): Chain {
  const connection = new Connection(endpoint(), "confirmed");
  const underwriter = signer ?? loadUnderwriter();
  const idl = JSON.parse(
    readFileSync(resolve(root, "target/idl/polaris.json"), "utf8")
  ) as Polaris;
  const provider = new AnchorProvider(connection, new KeypairWallet(underwriter) as any, {
    commitment: "confirmed",
  });
  const program = new Program<Polaris>(idl, provider);
  return {
    connection,
    program,
    underwriter,
    pda: (seeds) => PublicKey.findProgramAddressSync(seeds, program.programId)[0],
  };
}
