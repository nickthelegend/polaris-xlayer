/**
 * Build real on-chain state for the app to read.
 *
 * Every account this creates is created by a real signed transaction against a
 * real deployed program. There is no fixture anywhere in the path: the app
 * fetches exactly what this writes.
 *
 * Two schedule shapes on purpose. Most loans use a realistic 7-day interval so
 * the dates in the UI look like a consumer product; one uses the 60-second
 * floor so an installment actually falls due during a test run and the keeper's
 * collection path can be exercised for real rather than described.
 *
 * Progress on the weekly loans is created with `repay` — the borrower-signed
 * path — because a borrower paying early is a real thing that produces real
 * state, and it does not require waiting a week for the keeper.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorProvider, BN, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
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

const here = dirname(fileURLToPath(import.meta.url));
const IDL = JSON.parse(readFileSync(resolve(here, "../target/idl/polaris.json"), "utf8")) as Idl;

const CLUSTER = process.env.POLARIS_CLUSTER ?? "localnet";
const RPC =
  process.env.POLARIS_RPC_URL ??
  (CLUSTER === "localnet" ? "http://127.0.0.1:8899" : `https://api.${CLUSTER}.solana.com`);

const USDC = 1_000_000;
const DAY = 86_400;
const WEEK = 7 * DAY;

function defaultKeypairPath(): string {
  if (process.env.POLARIS_KEYPAIR) return process.env.POLARIS_KEYPAIR;
  const cfg = resolve(homedir(), ".config/solana/cli/config.yml");
  if (existsSync(cfg)) {
    const m = readFileSync(cfg, "utf8").match(/keypair_path:\s*(.+)/);
    if (m) return m[1].trim();
  }
  return "~/.config/solana/id.json";
}
const loadKeypair = (p: string) =>
  Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(readFileSync(p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p), "utf8")),
    ),
  );

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const authority = loadKeypair(defaultKeypairPath());
  const provider = new AnchorProvider(connection, new Wallet(authority), {
    commitment: "confirmed",
  });
  const program = new Program(IDL, provider);

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const u64 = (n: number | bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  const protocolPda = pda([Buffer.from("protocol")]);
  const liquidityVault = pda([Buffer.from("liquidity")]);
  const collateralVault = pda([Buffer.from("collateral_vault")]);

  const send = (ixs: any[], signers: Keypair[] = []) =>
    provider.sendAndConfirm(new Transaction().add(...ixs), signers);

  console.log(`cluster   ${CLUSTER}\nprogram   ${program.programId.toBase58()}\n`);

  // ---- mint ------------------------------------------------------------
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;
  const rent = await getMinimumBalanceForRentExemptMint(connection as any);
  await send(
    [
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mint,
        space: MINT_SIZE,
        lamports: rent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint, 6, authority.publicKey, null),
    ],
    [mintKp],
  );
  console.log(`mint      ${mint.toBase58()}`);

  const ataFor = async (owner: PublicKey, fund = 0) => {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    const ixs: any[] = [];
    if (!(await connection.getAccountInfo(ata))) {
      ixs.push(createAssociatedTokenAccountInstruction(authority.publicKey, ata, owner, mint));
    }
    if (fund > 0) ixs.push(createMintToInstruction(mint, ata, authority.publicKey, fund));
    if (ixs.length) await send(ixs);
    return ata;
  };
  const fundSol = (to: PublicKey, sol = 2) =>
    send([
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: to,
        lamports: sol * LAMPORTS_PER_SOL,
      }),
    ]);

  // ---- protocol --------------------------------------------------------
  const treasury = await ataFor(authority.publicKey, 200_000 * USDC);
  await program.methods
    // A 3-day grace and a 60-second interval floor: realistic for a consumer
    // book, while still allowing one short-schedule loan for the keeper tests.
    .initialize(new BN(3 * DAY), new BN(60), 50, 15_000)
    .accountsPartial({
      authority: authority.publicKey,
      protocol: protocolPda,
      stablecoin: mint,
      treasury,
      liquidityVault,
      collateralVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`protocol  initialized`);

  await program.methods
    .fundLiquidity(new BN(50_000 * USDC))
    .accountsPartial({
      funder: authority.publicKey,
      protocol: protocolPda,
      from: treasury,
      liquidityVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  // ---- merchants -------------------------------------------------------
  const merchantDefs = [
    { name: "Kettle & Co", icon: "◈" },
    { name: "Northline Audio", icon: "▲" },
    { name: "Ascent Demo Store", icon: "●" },
    { name: "Meridian", icon: "◇" },
    { name: "Relay Data", icon: "◆" },
  ];
  const merchants: any[] = [];
  for (const def of merchantDefs) {
    const kp = Keypair.generate();
    await fundSol(kp.publicKey, 0.5);
    const payout = await ataFor(kp.publicKey);
    const merchantPda = pda([Buffer.from("merchant"), kp.publicKey.toBuffer()]);
    await program.methods
      .registerMerchant(def.name, `https://polaris.test/${def.name}.json`)
      .accountsPartial({
        authority: kp.publicKey,
        protocol: protocolPda,
        merchant: merchantPda,
        payout,
        systemProgram: SystemProgram.programId,
      })
      .signers([kp])
      .rpc();
    await program.methods
      .setMerchantActive(true)
      .accountsPartial({ authority: authority.publicKey, protocol: protocolPda, merchant: merchantPda })
      .rpc();
    await program.methods
      .setMerchantMaxOrder(new BN(5_000 * USDC))
      .accountsPartial({ authority: authority.publicKey, protocol: protocolPda, merchant: merchantPda })
      .rpc();
    merchants.push({ ...def, kp, payout, pda: merchantPda });
    console.log(`merchant  ${def.name}`);
  }

  // ---- borrower --------------------------------------------------------
  const borrower = Keypair.generate();
  await fundSol(borrower.publicKey, 5);
  const borrowerAta = await ataFor(borrower.publicKey, 5_000 * USDC);
  const profilePda = pda([Buffer.from("profile"), borrower.publicKey.toBuffer()]);

  // One standing delegation, sized well above the book. This is the mechanism
  // every collection draws against.
  await send(
    [createApproveInstruction(borrowerAta, protocolPda, borrower.publicKey, BigInt(4_000 * USDC))],
    [borrower],
  );

  await program.methods
    .lockCollateral(new BN(200 * USDC))
    .accountsPartial({
      user: borrower.publicKey,
      protocol: protocolPda,
      profile: profilePda,
      from: borrowerAta,
      collateralVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([borrower])
    .rpc();
  console.log(`borrower  ${borrower.publicKey.toBase58()} · 200 USDC collateral locked`);

  const openLoan = async (m: any, principal: number, count: number, interval: number) => {
    const p: any = await (program.account as any).protocol.fetch(protocolPda);
    const id = Number(p.loanCount.toString());
    const loanPda = pda([Buffer.from("loan"), u64(id)]);
    await program.methods
      .createLoan(new BN(principal), count, new BN(interval))
      .accountsPartial({
        borrower: borrower.publicKey,
        protocol: protocolPda,
        profile: profilePda,
        merchant: m.pda,
        loan: loanPda,
        borrowerTokenAccount: borrowerAta,
        liquidityVault,
        merchantPayout: m.payout,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([borrower])
      .rpc();
    return { id, pda: loanPda };
  };

  const repay = (loanPda: PublicKey, amount: number) =>
    program.methods
      .repay(new BN(amount))
      .accountsPartial({
        borrower: borrower.publicKey,
        protocol: protocolPda,
        profile: profilePda,
        loan: loanPda,
        borrowerTokenAccount: borrowerAta,
        liquidityVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([borrower])
      .rpc();

  const ceilThreshold = (owed: number, count: number, k: number) =>
    k >= count ? owed : Math.ceil((owed * k) / count);

  // 1. A loan taken out and paid off in full. Lifts the score to 648.
  const done = await openLoan(merchants[2], 400 * USDC, 4, WEEK);
  {
    const l: any = await (program.account as any).loan.fetch(done.pda);
    const owed = Number(l.totalOwed.toString());
    for (let k = 1; k <= 4; k++) {
      const l2: any = await (program.account as any).loan.fetch(done.pda);
      await repay(done.pda, ceilThreshold(owed, 4, k) - Number(l2.totalRepaid.toString()));
    }
    console.log(`loan #${done.id}  Ascent Demo Store · repaid in full`);
  }

  // 2. A weekly plan, one installment in.
  const kettle = await openLoan(merchants[0], 240 * USDC, 4, WEEK);
  {
    const l: any = await (program.account as any).loan.fetch(kettle.pda);
    const owed = Number(l.totalOwed.toString());
    await repay(kettle.pda, ceilThreshold(owed, 4, 1));
    console.log(`loan #${kettle.id}  Kettle & Co · 1 of 4`);
  }

  // 3. The short-schedule loan. Its installments fall due in a minute, which is
  //    what lets the keeper actually collect during a test rather than in a week.
  const northline = await openLoan(merchants[1], 120 * USDC, 4, 60);
  console.log(`loan #${northline.id}  Northline Audio · 4 × 60s, nothing collected yet`);

  // ---- subscriptions ---------------------------------------------------
  /** Create a plan and leave it unsubscribed. */
  const createPlanOnly = async (m: any, price: number, period: number, name: string) => {
    const p: any = await (program.account as any).protocol.fetch(protocolPda);
    const id = Number(p.planCount.toString());
    const planPda = pda([Buffer.from("plan"), u64(id)]);
    await program.methods
      .createPlan(new BN(price), new BN(period), name)
      .accountsPartial({
        authority: m.kp.publicKey,
        protocol: protocolPda,
        merchant: m.pda,
        plan: planPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([m.kp])
      .rpc();
    console.log(`plan  #${id}  ${m.name} ${name} · offered, not subscribed`);
    return { id, pda: planPda };
  };

  const makePlan = async (m: any, price: number, period: number, name: string) => {
    const p: any = await (program.account as any).protocol.fetch(protocolPda);
    const id = Number(p.planCount.toString());
    const planPda = pda([Buffer.from("plan"), u64(id)]);
    await program.methods
      .createPlan(new BN(price), new BN(period), name)
      .accountsPartial({
        authority: m.kp.publicKey,
        protocol: protocolPda,
        merchant: m.pda,
        plan: planPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([m.kp])
      .rpc();

    await program.methods
      .subscribe()
      .accountsPartial({
        subscriber: borrower.publicKey,
        protocol: protocolPda,
        merchant: m.pda,
        plan: planPda,
        subscription: pda([Buffer.from("sub"), borrower.publicKey.toBuffer(), planPda.toBuffer()]),
        subscriberTokenAccount: borrowerAta,
        merchantPayout: m.payout,
        treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([borrower])
      .rpc();
    console.log(`plan  #${id}  ${m.name} ${name} · subscribed, period 1 charged`);
    return { id, pda: planPda };
  };

  const meridian = await makePlan(merchants[3], 12 * USDC, 30 * DAY, "Pro monthly");
  const relay = await makePlan(merchants[4], 29 * USDC, 60, "Indexer");

  // Offered but not taken. Without an unsubscribed plan the only path through
  // the checkout's Subscribe mode is the "you already subscribe" branch, and a
  // mode that can never do its thing is a stub with a nice label.
  const offered = await createPlanOnly(merchants[0], 8 * USDC, 30 * DAY, "Roasters club");

  // ---- write what the app needs ---------------------------------------
  const out = {
    cluster: CLUSTER,
    rpc: RPC,
    programId: program.programId.toBase58(),
    stablecoin: mint.toBase58(),
    protocol: protocolPda.toBase58(),
    liquidityVault: liquidityVault.toBase58(),
    collateralVault: collateralVault.toBase58(),
    treasury: treasury.toBase58(),
    // The seeded borrower's *address* only.
    //
    // Its key is deliberately not written. The app generates its own signer on
    // the device and keeps it in the platform keystore, so no secret belongs in
    // a file that gets committed. This address exists so the seeded history can
    // be inspected, not so anything can spend from it.
    seededBorrower: borrower.publicKey.toBase58(),
    merchants: merchants.map((m) => ({
      name: m.name,
      icon: m.icon,
      pda: m.pda.toBase58(),
      payout: m.payout.toBase58(),
      authority: m.kp.publicKey.toBase58(),
    })),
    loans: [done, kettle, northline].map((l) => ({ id: l.id, pda: l.pda.toBase58() })),
    plans: [meridian, relay, offered].map((p) => ({ id: p.id, pda: p.pda.toBase58() })),
    seededAt: new Date().toISOString(),
  };

  const file = resolve(here, `../deployments/${CLUSTER}-seed.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");

  const prof: any = await (program.account as any).creditProfile.fetch(profilePda);
  const proto: any = await (program.account as any).protocol.fetch(protocolPda);
  console.log(`\nscore     ${prof.score}  (${prof.onTimePayments} on time)`);
  console.log(`debt      ${Number(prof.activeDebt.toString()) / USDC} USDC`);
  console.log(`loans     ${proto.loanCount}   plans ${proto.planCount}`);
  console.log(`\nwrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
