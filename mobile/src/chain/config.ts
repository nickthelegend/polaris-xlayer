// Side-effect import, and it must come first: these modules pull in
// @solana/web3.js, which captures the global Buffer as it evaluates. If it
// loads before the polyfill, account data arrives as a plain Uint8Array and
// buffer-layout dies on `b.readUIntLE is not a function` — deep inside a
// borsh decode, nowhere near the cause.
import "./polyfills";

import { PublicKey } from "@solana/web3.js";

import deployment from "./deployment.json";

/**
 * Where the app points, and who it signs as.
 *
 * `deployment.json` is written by `scripts/seed.ts` against whichever cluster
 * it ran on, so the app is always pointed at a program that actually exists
 * rather than at an address someone typed.
 *
 * There is deliberately no key here. The signer is generated on the device and
 * kept in the platform keystore — see `wallet.ts`. This file carries public
 * configuration only, so it is safe to commit and safe to read.
 */
export const RPC_URL = deployment.rpc;
export const CLUSTER = deployment.cluster;
export const PROGRAM_ID = new PublicKey(deployment.programId);
export const STABLECOIN = new PublicKey(deployment.stablecoin);
export const TREASURY = new PublicKey(deployment.treasury);

export type MerchantRef = {
  name: string;
  icon: string;
  pda: PublicKey;
  payout: PublicKey;
};

/**
 * The merchants registered on this deployment.
 *
 * Every one is a real `Merchant` account created by `scripts/seed.ts`; the
 * addresses here are the same PDAs the program checks at origination, so a
 * checkout against one of these is a checkout the program will accept.
 */
export const merchants: MerchantRef[] = deployment.merchants.map((m) => ({
  name: m.name,
  icon: m.icon,
  pda: new PublicKey(m.pda),
  payout: new PublicKey(m.payout),
}));

/** Merchant display names, keyed by their on-chain PDA. */
export const merchantDirectory = new Map(
  deployment.merchants.map((m) => [m.pda, { name: m.name, icon: m.icon }]),
);

export const explorerTx = (signature: string) =>
  CLUSTER === "localnet"
    ? `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`
    : `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`;
