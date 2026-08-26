import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";

import { PROGRAM_ID } from "./config";

const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

/**
 * A u64 seed, little-endian.
 *
 * Written out byte by byte rather than through `writeBigUInt64LE`: the `buffer`
 * shim React Native uses does not carry Node's overload for it, and a seed that
 * encodes differently from the program's `to_le_bytes()` derives a different
 * address — which fails as "account does not exist" far from the cause.
 */
const u64 = (value: number | bigint) => {
  const b = Buffer.alloc(8);
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
};

/**
 * Every address the app needs, derived rather than stored.
 *
 * The same seeds the program uses, so an address the app computes is an address
 * the program will accept — there is no directory to fall out of sync.
 */
export const pdas = {
  protocol: pda([Buffer.from("protocol")]),
  liquidityVault: pda([Buffer.from("liquidity")]),
  collateralVault: pda([Buffer.from("collateral_vault")]),
  profileOf: (user: PublicKey) => pda([Buffer.from("profile"), user.toBuffer()]),
  loanOf: (id: number | bigint) => pda([Buffer.from("loan"), u64(id)]),
  planOf: (id: number | bigint) => pda([Buffer.from("plan"), u64(id)]),
  merchantOf: (authority: PublicKey) =>
    pda([Buffer.from("merchant"), authority.toBuffer()]),
  subOf: (subscriber: PublicKey, plan: PublicKey) =>
    pda([Buffer.from("sub"), subscriber.toBuffer(), plan.toBuffer()]),
  paymentOf: (merchant: PublicKey, orderRef: Uint8Array) =>
    pda([Buffer.from("payment"), merchant.toBuffer(), orderRef]),
};
