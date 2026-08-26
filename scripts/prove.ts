/**
 * Prove a deployment works, using one wallet for every role.
 *
 *   POLARIS_CLUSTER=devnet pnpm exec tsx scripts/prove.ts
 *
 * The seed script stands up a whole demo — five merchants, a borrower with
 * history, subscriptions — and needs SOL for each of them. This does the
 * smallest thing that actually proves the deployment is real: registers the
 * signer as a merchant, opens a plan against it, and reads the result back off
 * the chain. No SOL is transferred anywhere, so it runs on the fumes left in a
 * faucet-limited wallet.
 *
 * Idempotent: re-running reuses whatever already exists.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createApproveInstruction,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";

/**
 * A distinct order reference per plan.
 *
 * The program refuses to finance the same (merchant, order) twice, so a script
 * that opens several plans needs a different one each time.
 */
function orderRefFor(label: string): number[] {
  const bytes = new Uint8Array(32);
  const utf8 = new TextEncoder().encode(label);
  bytes.set(utf8.slice(0, 32), Math.max(0, 32 - utf8.length));
  return Array.from(bytes);
}


const here = dirname(fileURLToPath(import.meta.url));
const CLUSTER = process.env.POLARIS_CLUSTER ?? "localnet";
const RPC =
  process.env.POLARIS_RPC_URL ??
  (CLUSTER === "localnet" ? "http://127.0.0.1:8899" : `https://api.${CLUSTER}.solana.com`);
const IDL = JSON.parse(readFileSync(resolve(here, "../target/idl/polaris.json"), "utf8")) as Idl;
const USDC = 1_000_000;
const PACE = Number(process.env.POLARIS_PACE_MS ?? (CLUSTER === "localnet" ? 0 : 1500));
const pace = () => (PACE ? new Promise((r) => setTimeout(r, PACE)) : Promise.resolve());

function loadKeypair(): Keypair {
  const cfg = resolve(homedir(), ".config/solana/cli/config.yml");
  const path =
    process.env.POLARIS_KEYPAIR ??
    (existsSync(cfg)
      ? readFileSync(cfg, "utf8").match(/keypair_path:\s*(.+)/)![1].trim()
      : "~/.config/solana/id.json");
  const p = path.startsWith("~") ? resolve(homedir(), path.slice(2)) : path;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const me = loadKeypair();
  const provider = new AnchorProvider(
    connection,
    {
      publicKey: me.publicKey,
      signTransaction: async (t: any) => (t.partialSign(me), t),
      signAllTransactions: async (ts: any[]) => ts.map((t) => (t.partialSign(me), t)),
    } as any,
    { commitment: "confirmed" },
  );
  const program = new Program(IDL, provider);

  const pda = (s: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(s, program.programId)[0];
  const u64 = (n: number) => {
    const b = Buffer.alloc(8);
    let v = BigInt(n);
    for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
    return b;
  };

  const protocolPda = pda([Buffer.from("protocol")]);
  const liquidityVault = pda([Buffer.from("liquidity")]);
  const collateralVault = pda([Buffer.from("collateral_vault")]);

  /*
   * Stand the protocol up if it is not there yet.
   *
   * This script's job is to prove a deployment, and a freshly deployed program
   * has nothing to prove yet — it used to fail on "Account does not exist"
   * against exactly the deployment someone most wants to check. Everything
   * below is idempotent, so running it against a live protocol skips straight
   * to opening a plan.
   */
  let proto: any = await (program.account as any).protocol.fetchNullable(protocolPda);
  if (!proto) {
    const mintKp = Keypair.generate();
    const rent = await getMinimumBalanceForRentExemptMint(connection);
    const treasuryAta = getAssociatedTokenAddressSync(mintKp.publicKey, me.publicKey, true);

    await pace();
    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: me.publicKey,
          newAccountPubkey: mintKp.publicKey,
          space: MINT_SIZE,
          lamports: rent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(mintKp.publicKey, 6, me.publicKey, null),
        createAssociatedTokenAccountInstruction(
          me.publicKey,
          treasuryAta,
          me.publicKey,
          mintKp.publicKey,
        ),
      ),
      [mintKp],
    );

    await pace();
    await program.methods
      // A 60s grace and a 60s interval floor: this is a demonstration cluster,
      // and a three-day grace makes the liquidation path unobservable.
      .initialize(new BN(60), new BN(60), 50, 15_000)
      .accountsPartial({
        authority: me.publicKey,
        protocol: protocolPda,
        stablecoin: mintKp.publicKey,
        treasury: treasuryAta,
        liquidityVault,
        collateralVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await pace();
    await provider.sendAndConfirm(
      new Transaction().add(
        createMintToInstruction(mintKp.publicKey, treasuryAta, me.publicKey, 10_000 * USDC),
      ),
    );
    await pace();
    await program.methods
      .fundLiquidity(new BN(5_000 * USDC))
      .accountsPartial({
        funder: me.publicKey,
        protocol: protocolPda,
        from: treasuryAta,
        liquidityVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("0. stood the protocol up and funded the pool");
    proto = await (program.account as any).protocol.fetch(protocolPda);
  }

  const mint = proto.stablecoin as PublicKey;

  console.log(`cluster   ${CLUSTER}`);
  console.log(`program   ${program.programId.toBase58()}`);
  console.log(`signer    ${me.publicKey.toBase58()}`);
  console.log(
    `balance   ${(await connection.getBalance(me.publicKey)) / 1e9} SOL\n`,
  );

  const ata = getAssociatedTokenAddressSync(mint, me.publicKey, true);
  if (!(await connection.getAccountInfo(ata))) {
    await pace();
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(me.publicKey, ata, me.publicKey, mint),
    );
    await provider.sendAndConfirm(tx);
  }
  await pace();
  await provider.sendAndConfirm(
    new Transaction().add(createMintToInstruction(mint, ata, me.publicKey, 2_000 * USDC)),
  );
  console.log("1. minted 2,000 USDC to the signer");

  // The signer doubles as the merchant. register_merchant is seeded by the
  // authority, so this address is its own merchant account.
  const merchantPda = pda([Buffer.from("merchant"), me.publicKey.toBuffer()]);
  if (!(await connection.getAccountInfo(merchantPda))) {
    await pace();
    await program.methods
      .registerMerchant("Proof Merchant", "https://polaris.test/proof.json")
      .accountsPartial({
        authority: me.publicKey,
        protocol: protocolPda,
        merchant: merchantPda,
        payout: ata,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("2. registered a merchant");
  } else {
    console.log("2. merchant already registered");
  }

  await pace();
  await program.methods
    .setMerchantActive(true)
    .accountsPartial({ authority: me.publicKey, protocol: protocolPda, merchant: merchantPda })
    .rpc();
  await pace();
  await program.methods
    .setMerchantMaxOrder(new BN(5_000 * USDC))
    .accountsPartial({ authority: me.publicKey, protocol: protocolPda, merchant: merchantPda })
    .rpc();
  console.log("3. activated it");

  // Open a real plan: the approval and the origination in one transaction.
  const p2: any = await (program.account as any).protocol.fetch(protocolPda);
  const loanId = Number(p2.loanCount.toString());
  const loanPda = pda([Buffer.from("loan"), u64(loanId)]);
  const profilePda = pda([Buffer.from("profile"), me.publicKey.toBuffer()]);

  const principal = 200 * USDC;
  const interval = 7 * 86_400;
  const interest = Math.floor((principal * 1_000 * 4 * interval) / (10_000 * 365 * 86_400));
  const owed = principal + interest;

  await pace();
  const originate = await program.methods
    .createLoan(new BN(principal), 4, new BN(interval), orderRefFor("prove-0"))
    .accountsPartial({
      borrower: me.publicKey,
      payer: me.publicKey,
      protocol: protocolPda,
      profile: profilePda,
      merchant: merchantPda,
      loan: loanPda,
      borrowerTokenAccount: ata,
      liquidityVault,
      merchantPayout: ata,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const sig = await provider.sendAndConfirm(
    new Transaction().add(
      createApproveInstruction(ata, protocolPda, me.publicKey, BigInt(owed)),
      originate,
    ),
  );
  console.log(`4. opened a plan — ${sig}`);

  const loan: any = await (program.account as any).loan.fetch(loanPda);
  const prof: any = await (program.account as any).creditProfile.fetch(profilePda);
  console.log(`\n   loan #${loan.id}  ${loan.installmentsPaid}/${loan.installmentCount}`);
  console.log(`   owed        ${Number(loan.totalOwed.toString()) / 1e6}`);
  console.log(`   interest    ${(Number(loan.totalOwed) - Number(loan.principal)) / 1e6}`);
  console.log(`   score       ${prof.score}`);
  console.log(
    `\n   https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`,
  );
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
