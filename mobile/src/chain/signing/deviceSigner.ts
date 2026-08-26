import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";

import { loadOrCreateWallet, resetWallet } from "../wallet";
import type { ChainSigner } from "./types.ts";

/**
 * The signer this build falls back to: a keypair generated on the device and
 * kept in the platform keystore.
 *
 * Real signatures against the real program, and no private key in the
 * repository — but the key belongs to the app rather than to a wallet the user
 * already trusts, which is exactly why `mwaSigner` exists beside it.
 */
class DeviceSigner implements ChainSigner {
  readonly kind = "device" as const;
  readonly label = "This device";
  private readonly payer: Keypair;

  constructor(payer: Keypair) {
    this.payer = payer;
  }

  get publicKey() {
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

  async disconnect(): Promise<void> {
    // Forgetting the key is the only meaningful disconnect for a device
    // signer, and it starts the next launch as a brand new borrower.
    await resetWallet();
  }
}

export async function createDeviceSigner(): Promise<ChainSigner> {
  return new DeviceSigner(await loadOrCreateWallet());
}
