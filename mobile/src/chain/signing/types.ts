import type { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

/**
 * The one thing the chain layer needs from a wallet.
 *
 * Deliberately the same three members Anchor's provider wants, plus enough
 * identity for the UI to say whose key is signing. Everything else in
 * `src/chain` builds instructions and never learns where the signature came
 * from, which is the whole reason swapping the signer is a small change.
 */
export type SignerKind = "device" | "mwa";

export interface ChainSigner {
  readonly kind: SignerKind;
  /** Shown to the user: "This device" or the wallet's own label. */
  readonly label: string;
  readonly publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
  /** Drop the authorization. A device key has nothing to drop. */
  disconnect(): Promise<void>;
}

/**
 * How a Mobile Wallet Adapter attempt failed.
 *
 * Every one of these needs a different sentence in the UI and, in one case, a
 * different recovery: a stale authorization is the only kind worth retrying
 * automatically.
 */
export type MwaFailure =
  | { kind: "no-wallet" }
  | { kind: "declined" }
  | { kind: "stale-auth" }
  | { kind: "not-submitted" }
  | { kind: "cancelled" }
  | { kind: "unsupported" }
  | { kind: "unknown"; message: string };
