// Side-effect import, and it must come first: these modules pull in
// @solana/web3.js, which captures the global Buffer as it evaluates. If it
// loads before the polyfill, account data arrives as a plain Uint8Array and
// buffer-layout dies on `b.readUIntLE is not a function` — deep inside a
// borsh decode, nowhere near the cause.
import "./polyfills";

import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import idl from "./idl.json";
import { RPC_URL, wallet } from "./config";

/**
 * One connection and one program instance for the whole app.
 *
 * `confirmed` rather than `finalized` for reads: a borrower who has just paid
 * should see it, and a screen that waits ~13 seconds for finality to show an
 * installment they watched land reads as broken. Anything that decides money
 * is decided by the program, not by what this fetched.
 */
export const connection = new Connection(RPC_URL, {
  commitment: "confirmed",
  // The default is 30s. A dead RPC should surface an error state quickly
  // rather than leaving the screen spinning.
  confirmTransactionInitialTimeout: 20_000,
});

/**
 * A signer Anchor will accept.
 *
 * Anchor's own `Wallet` export is `NodeWallet` — it loads a keypair off the
 * filesystem, so it is stripped from browser and React Native bundles by the
 * package's `browser` field. Importing it compiles and then throws
 * "Wallet is not a constructor" at runtime, which is a fault that only shows
 * up when the app actually runs.
 *
 * The interface is three members, so it is implemented here rather than pulled
 * in from a wallet-adapter package the app does not otherwise need. Swapping in
 * Mobile Wallet Adapter later means replacing this class and nothing else:
 * every instruction is already built by the chain layer, not by a screen.
 */
class KeypairWallet {
  constructor(readonly payer: Keypair) {}

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof VersionedTransaction) {
      tx.sign([this.payer]);
    } else {
      tx.partialSign(this.payer);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

const provider = new AnchorProvider(connection, new KeypairWallet(wallet), {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});

export const program = new Program(idl as Idl, provider);
export { provider };
