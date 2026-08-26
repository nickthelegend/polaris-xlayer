// Side-effect import, and it must come first: this module pulls in
// @solana/web3.js, which captures the global Buffer as it evaluates. If it
// loads before the polyfill, account data arrives as a plain Uint8Array and
// buffer-layout dies on `b.readUIntLE is not a function` — deep inside a
// borsh decode, nowhere near the cause.
import "./polyfills";

import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import idl from "./idl.json";
import { RPC_URL, STABLECOIN } from "./config";

/**
 * A signer Anchor will accept.
 *
 * Anchor's own `Wallet` export is `NodeWallet` — it loads a keypair off the
 * filesystem, so it is stripped from browser and React Native bundles by the
 * package's `browser` field. Importing it compiles and then throws
 * "Wallet is not a constructor" at runtime, a fault that only shows up when the
 * app actually runs.
 *
 * The interface is three members, so it is implemented here rather than pulling
 * in a wallet-adapter package the app does not otherwise need.
 */
class KeypairWallet {
  constructor(readonly payer: Keypair) {}

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof VersionedTransaction) tx.sign([this.payer]);
    else tx.partialSign(this.payer);
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

export type Client = {
  connection: Connection;
  provider: AnchorProvider;
  program: Program<Idl>;
  wallet: Keypair;
  tokenAccount: PublicKey;
};

/**
 * The client is built once the signer is known, not at module load.
 *
 * The wallet now comes from the device keystore, which is an async read, so
 * there is nothing to construct until it resolves. Holding the instance here
 * rather than threading it through every call keeps the query layer unchanged.
 */
let client: Client | null = null;

export function initClient(wallet: Keypair): Client {
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

  const provider = new AnchorProvider(connection, new KeypairWallet(wallet), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  client = {
    connection,
    provider,
    program: new Program(idl as Idl, provider),
    wallet,
    tokenAccount: getAssociatedTokenAddressSync(STABLECOIN, wallet.publicKey, true),
  };
  return client;
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
export const getWallet = () => require_().wallet;
export const getTokenAccount = () => require_().tokenAccount;
export const isReady = () => client !== null;
