import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const CLUSTERS: Record<string, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

export type KeeperConfig = {
  connection: Connection;
  keeper: Keypair;
  program: Program<Idl>;
  programId: PublicKey;
  cluster: string;
  dryRun: boolean;
  /** Seconds between passes when running as a service. */
  intervalSeconds: number;
  pdas: ReturnType<typeof derivePdas>;
};

/**
 * Whatever `solana config get` is pointed at, unless overridden.
 *
 * Hardcoding `id.json` assumes a default the Solana CLI does not enforce — the
 * keypair path is configurable and frequently is not that. A keeper that
 * cannot find a key it was told about is a confusing first-run failure.
 */
function defaultKeypairPath(): string {
  if (process.env.POLARIS_KEEPER_KEYPAIR) return process.env.POLARIS_KEEPER_KEYPAIR;
  const cfg = resolve(homedir(), ".config/solana/cli/config.yml");
  if (existsSync(cfg)) {
    const m = readFileSync(cfg, "utf8").match(/keypair_path:\s*(.+)/);
    if (m) return m[1].trim();
  }
  return "~/.config/solana/id.json";
}

function loadKeypair(path: string): Keypair {
  const expanded = path.startsWith("~") ? resolve(homedir(), path.slice(2)) : resolve(path);
  if (!existsSync(expanded)) {
    throw new Error(
      `No keypair at ${expanded}. Set POLARIS_KEEPER_KEYPAIR, or run: solana-keygen new -o ${expanded}`,
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(expanded, "utf8"))));
}

export function derivePdas(programId: PublicKey) {
  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, programId)[0];
  const u64 = (n: number | bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  return {
    protocol: pda([Buffer.from("protocol")]),
    liquidityVault: pda([Buffer.from("liquidity")]),
    collateralVault: pda([Buffer.from("collateral_vault")]),
    profileOf: (user: PublicKey) => pda([Buffer.from("profile"), user.toBuffer()]),
    loanOf: (id: number | bigint) => pda([Buffer.from("loan"), u64(id)]),
    merchantOf: (authority: PublicKey) => pda([Buffer.from("merchant"), authority.toBuffer()]),
    planOf: (id: number | bigint) => pda([Buffer.from("plan"), u64(id)]),
    subOf: (subscriber: PublicKey, plan: PublicKey) =>
      pda([Buffer.from("sub"), subscriber.toBuffer(), plan.toBuffer()]),
  };
}

export function loadConfig(idl: Idl): KeeperConfig {
  const cluster = process.env.POLARIS_CLUSTER ?? "devnet";
  const rpc = process.env.POLARIS_RPC_URL ?? CLUSTERS[cluster] ?? cluster;
  const connection = new Connection(rpc, "confirmed");

  const keeper = loadKeypair(defaultKeypairPath());

  const provider = new AnchorProvider(connection, new Wallet(keeper), {
    commitment: "confirmed",
  });
  const program = new Program(idl, provider);
  const programId = program.programId;

  return {
    connection,
    keeper,
    program,
    programId,
    cluster,
    dryRun: process.env.KEEPER_DRY_RUN === "true",
    /*
     * How often `watch` wakes up.
     *
     * A minute is right for a consumer book: the protocol's own interval floor
     * is sixty seconds, so waking faster than that can only ever find the same
     * nothing. Floored at five so a misconfigured deployment cannot turn the
     * keeper into a denial-of-service against its own RPC.
     */
    intervalSeconds: Math.max(5, Number(process.env.KEEPER_INTERVAL_SECONDS ?? 60)),
    pdas: derivePdas(programId),
  };
}

/**
 * Refuse to run against a cluster this protocol is not on.
 *
 * Without this the keeper pointed wherever `solana config get` happened to say
 * -- devnet, on a machine that had been deploying there -- ran a full
 * collection pass and a full subscription pass against a chain with no program
 * on it, and reported "0 due · 0 collected · 0 failed" for both. That is the
 * worst possible failure for a crank: it looks exactly like a healthy, quiet
 * book. It only crashed later, on a protocol fetch, with "Account does not
 * exist" and a pubkey that means nothing to anyone.
 *
 * A keeper that cannot see its own protocol has nothing to say about what is
 * due, so it says that instead of saying zero.
 */
export async function assertDeployed(cfg: KeeperConfig): Promise<void> {
  const program = await cfg.connection.getAccountInfo(cfg.programId);
  if (!program) {
    throw new Error(
      `No program at ${cfg.programId.toBase58()} on ${cfg.cluster} (${cfg.connection.rpcEndpoint}).\n` +
        "The keeper follows `solana config get` unless POLARIS_CLUSTER or POLARIS_RPC_URL says otherwise.\n" +
        "For a local run:  POLARIS_CLUSTER=localnet pnpm --filter @polaris/keeper-solana start",
    );
  }

  const protocol = await cfg.connection.getAccountInfo(cfg.pdas.protocol);
  if (!protocol) {
    throw new Error(
      `The program is deployed on ${cfg.cluster} but has never been initialised there.\n` +
        `No protocol account at ${cfg.pdas.protocol.toBase58()}.\n` +
        "Run scripts/prove.ts or ./scripts/reset-local.sh against that cluster first.",
    );
  }
}
