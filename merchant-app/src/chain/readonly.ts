import "./polyfills";

import { AnchorProvider, Program, type Idl, type Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import idl from "./idl.json";
import { PROGRAM_ID, RPC_URL } from "./config";

/**
 * A read-only view of the program.
 *
 * A merchant never signs. Their whole book is public state under their own
 * address, so this app holds no key and cannot hold one: the provider is
 * built around a throwaway keypair that exists only because Anchor's
 * constructor requires a wallet to read. Nothing it could sign is ever sent.
 *
 * That is the same reason the merchant page on the gateway needs no login.
 */
let cached: { connection: Connection; program: Program<Idl> } | null = null;

export function chain() {
  if (cached) return cached;

  const connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 45_000,
  });

  const readOnly = Keypair.generate();
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: readOnly.publicKey,
      signTransaction: async () => {
        throw new Error("The merchant app does not sign.");
      },
      signAllTransactions: async () => {
        throw new Error("The merchant app does not sign.");
      },
    } as unknown as Wallet,
    { commitment: "confirmed" },
  );

  const program = new Program(idl as Idl, provider);
  cached = { connection, program };
  return cached;
}

export { PROGRAM_ID };
export const programId = () => new PublicKey(PROGRAM_ID);
