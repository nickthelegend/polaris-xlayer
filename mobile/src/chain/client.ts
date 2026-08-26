// Side-effect import, and it must come first: this module pulls in
// @solana/web3.js, which captures the global Buffer as it evaluates. If it
// loads before the polyfill, account data arrives as a plain Uint8Array and
// buffer-layout dies on `b.readUIntLE is not a function` — deep inside a
// borsh decode, nowhere near the cause.
import "./polyfills";

import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

import idl from "./idl.json";
import type { ChainSigner } from "./signing/types.ts";
import { PROGRAM_ID, RPC_URL, STABLECOIN } from "./config";

/**
 * Anchor needs a wallet object with three members. `ChainSigner` is that
 * interface plus enough identity for the UI to say whose key is signing, so it
 * is handed to the provider directly — there is nothing to adapt.
 *
 * Anchor's own `Wallet` export is `NodeWallet`, which reads a keypair off the
 * filesystem and is stripped from React Native bundles by the package's
 * `browser` field. Importing it compiles and then throws "Wallet is not a
 * constructor" at runtime, which is why this app has never used it.
 */
export type Client = {
  connection: Connection;
  provider: AnchorProvider;
  program: Program<Idl>;
  signer: ChainSigner;
  tokenAccount: PublicKey;
};

/**
 * The client is built once the signer is known, not at module load.
 *
 * Which signer that is now depends on the platform and on whether the user has
 * connected a wallet app, both of which are async, so there is nothing to
 * construct until they resolve. Holding the instance here rather than
 * threading it through every call keeps the query layer unchanged.
 */
let client: Client | null = null;

export function initClient(signer: ChainSigner): Client {
  /*
   * The IDL and the deployment have to name the same program.
   *
   * Anchor takes the program id from the IDL, while everything else in the app
   * takes it from deployment.json. When a rebuild issued a new program id and
   * only deployment.json was synced, the two silently disagreed and every
   * transaction came back "Attempt to load a program that does not exist" --
   * an error about a program that existed perfectly well, at the other address.
   * Better to refuse to start, and say which two files disagree.
   */
  if ((idl as { address?: string }).address !== PROGRAM_ID.toBase58()) {
    throw new Error(
      `idl.json is for ${(idl as { address?: string }).address}, but deployment.json ` +
        `says ${PROGRAM_ID.toBase58()}. Re-run ./scripts/reset-local.sh to sync them.`,
    );
  }

  const connection = new Connection(RPC_URL, {
    // `confirmed` rather than `finalized` for reads: a borrower who has just
    // paid should see it, and waiting ~13 seconds for finality to show an
    // installment they watched land reads as broken. Anything that decides
    // money is decided by the program, not by what this fetched.
    commitment: "confirmed",
    // The default is 30s. A dead RPC should surface an error state quickly
    // rather than leaving the screen spinning.
    confirmTransactionInitialTimeout: 20_000,
  });

  const provider = new AnchorProvider(connection, signer, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  client = {
    connection,
    provider,
    program: new Program(idl as Idl, provider),
    signer,
    tokenAccount: getAssociatedTokenAddressSync(STABLECOIN, signer.publicKey, true),
  };
  return client;
}

/** Drop the client so a different wallet can be connected in its place. */
export function clearClient(): void {
  client = null;
}

function require_(): Client {
  if (!client) {
    // This message can reach the screen, because the query layer's failures
    // are surfaced to the user rather than swallowed. So it says what a person
    // can do about it, not what went wrong internally.
    throw new Error("Still setting up your wallet. Give it a moment.");
  }
  return client;
}

export const getClient = require_;
export const getProgram = () => require_().program;
export const getConnection = () => require_().connection;
export const getProvider = () => require_().provider;
export const getSigner = () => require_().signer;
export const getPublicKey = () => require_().signer.publicKey;
export const getTokenAccount = () => require_().tokenAccount;
export const isReady = () => client !== null;
