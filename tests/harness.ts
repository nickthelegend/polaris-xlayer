/**
 * Test harness.
 *
 * Runs against bankrun rather than a validator, for one reason that matters:
 * every rule in this protocol is a function of time. The minimum installment
 * interval is an hour and the default grace period is three days, so a suite
 * that cannot move the clock can only ever test origination. `warpBy` sets the
 * Clock sysvar directly, which makes a four-installment loan collected over
 * four weeks — and a default liquidated after grace — a sub-second test.
 */
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  AccountLayout,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createApproveInstruction,
  createRevokeInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { startAnchor, Clock, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { createHash } from "crypto";

import type { Polaris } from "../target/types/polaris";
import IDL from "../target/idl/polaris.json";

export const USDC = 1_000_000; // 6 decimals
export const HOUR = 3600;
export const DAY = 86_400;
export const WEEK = 7 * DAY;

export type Harness = Awaited<ReturnType<typeof setup>>;

/**
 * A merchant order id as the program sees it: exactly 32 bytes.
 *
 * Short ids go in directly, right-aligned; anything longer is hashed. The
 * program takes only these 32 bytes, so there is no second representation for
 * it to disagree with.
 */
export function orderRef(orderId: string): Buffer {
  const bytes = Buffer.from(orderId, "utf8");
  if (bytes.length <= 32) {
    const out = Buffer.alloc(32);
    bytes.copy(out, 32 - bytes.length);
    return out;
  }
  return createHash("sha256").update(bytes).digest();
}

export async function setup(
  opts: { gracePeriod?: number; minInterval?: number; feeBps?: number } = {},
) {
  const context = await startAnchor(process.cwd(), [], []);
  const provider = new BankrunProvider(context);
  const program = new Program<Polaris>(IDL as Polaris, provider);
  const payer = context.payer;

  // ---- PDAs ------------------------------------------------------------
  const pid = program.programId;
  const [protocol] = PublicKey.findProgramAddressSync([Buffer.from("protocol")], pid);
  const [liquidityVault] = PublicKey.findProgramAddressSync([Buffer.from("liquidity")], pid);
  const [collateralVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral_vault")],
    pid,
  );
  const profileOf = (user: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("profile"), user.toBuffer()], pid)[0];
  const loanOf = (id: number | bigint) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("loan"), new BN(id.toString()).toArrayLike(Buffer, "le", 8)],
      pid,
    )[0];
  const merchantOf = (authority: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("merchant"), authority.toBuffer()], pid)[0];
  const planOf = (id: number | bigint) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("plan"), new BN(id.toString()).toArrayLike(Buffer, "le", 8)],
      pid,
    )[0];
  const subOf = (subscriber: PublicKey, plan: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("sub"), subscriber.toBuffer(), plan.toBuffer()],
      pid,
    )[0];
  const paymentOf = (merchant: PublicKey, orderId: string) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("payment"), merchant.toBuffer(), orderRef(orderId)],
      pid,
    )[0];

  // ---- the clock -------------------------------------------------------
  //
  // Two jobs, and they fight each other unless they are the same function.
  //
  // Bankrun rejects a transaction whose signature it has already seen, and two
  // identical instructions signed by the same key against the same blockhash
  // *are* the same signature. Refusing a second subscription, or a second
  // origination against an exhausted delegation, are real behaviours this suite
  // has to test — so the bank has to advance between sends or the runtime
  // refuses the transaction before the program ever runs, and the test passes
  // for the wrong reason.
  //
  // But `warpToSlot` recomputes the clock from the slot, which throws away any
  // timestamp a previous warp set. So the intended time is tracked here and
  // re-applied after every advance, and every send goes through it.
  let simulatedTime: bigint | null = null;

  async function advance(seconds = 0) {
    const c = await context.banksClient.getClock();
    const target = (simulatedTime ?? c.unixTimestamp) + BigInt(Math.floor(seconds));
    context.warpToSlot(c.slot + 1n);
    const after = await context.banksClient.getClock();
    context.setClock(
      new Clock(
        after.slot,
        after.epochStartTimestamp,
        after.epoch,
        after.leaderScheduleEpoch,
        target,
      ),
    );
    simulatedTime = target;
  }

  /** Advance the bank without moving the clock. */
  const tick = () => advance(0);

  /** Move the chain clock forward. */
  const warpBy = (seconds: number) => advance(seconds);

  async function now(): Promise<number> {
    return Number((await context.banksClient.getClock()).unixTimestamp);
  }

  // Every transaction Anchor sends advances the bank first, so no test has to
  // remember to do it and none can silently start passing for the wrong reason.
  const anchorSend = provider.sendAndConfirm!.bind(provider);
  provider.sendAndConfirm = async (tx: any, signers?: any, opts?: any) => {
    await advance(0);
    return anchorSend(tx, signers, opts);
  };

  // ---- transaction plumbing -------------------------------------------
  async function send(ixs: any[], signers: Keypair[] = []) {
    await advance(0);
    const tx = new Transaction();
    tx.add(...ixs);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await context.banksClient.getLatestBlockhash())![0];
    tx.sign(payer, ...signers);
    return context.banksClient.processTransaction(tx);
  }

  async function fundSol(pubkey: PublicKey, sol = 100) {
    await send([
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: pubkey,
        lamports: sol * 1_000_000_000,
      }),
    ]);
  }

  /** A funded keypair, ready to sign. */
  async function wallet(sol = 100) {
    const kp = Keypair.generate();
    await fundSol(kp.publicKey, sol);
    return kp;
  }

  // ---- the stablecoin --------------------------------------------------
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;
  const mintAuthority = payer;
  {
    const rent = await getMinimumBalanceForRentExemptMint({
      getMinimumBalanceForRentExemption: async (n: number) =>
        Number((await context.banksClient.getRent()).minimumBalance(BigInt(n))),
    } as any);
    await send(
      [
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mint,
          space: MINT_SIZE,
          lamports: rent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(mint, 6, mintAuthority.publicKey, null),
      ],
      [mintKp],
    );
  }

  /** Create the owner's ATA and mint them `amount` base units. */
  async function tokenAccount(owner: PublicKey, amount = 0) {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    const ixs: any[] = [
      createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint),
    ];
    if (amount > 0) {
      ixs.push(createMintToInstruction(mint, ata, mintAuthority.publicKey, amount));
    }
    await send(ixs);
    return ata;
  }

  async function mintTo(ata: PublicKey, amount: number) {
    await send([createMintToInstruction(mint, ata, mintAuthority.publicKey, amount)]);
  }

  /**
   * The Solana analogue of `approve(spender, amount)`. The protocol PDA becomes
   * the delegate; every later collection is drawn against this.
   */
  async function delegate(owner: Keypair, ata: PublicKey, amount: number) {
    await send([createApproveInstruction(ata, protocol, owner.publicKey, amount)], [owner]);
  }

  async function revoke(owner: Keypair, ata: PublicKey) {
    await send([createRevokeInstruction(ata, owner.publicKey)], [owner]);
  }

  async function readToken(ata: PublicKey) {
    const acc = await context.banksClient.getAccount(ata);
    if (!acc) throw new Error(`no token account at ${ata.toBase58()}`);
    const d = AccountLayout.decode(Buffer.from(acc.data));
    return {
      amount: Number(d.amount),
      delegate: d.delegateOption === 1 ? new PublicKey(d.delegate) : null,
      delegatedAmount: d.delegateOption === 1 ? Number(d.delegatedAmount) : 0,
      owner: new PublicKey(d.owner),
    };
  }

  // ---- stand the protocol up ------------------------------------------
  const treasuryOwner = await wallet();
  const treasury = await tokenAccount(treasuryOwner.publicKey);

  await program.methods
    .initialize(
      new BN(opts.gracePeriod ?? DAY),
      new BN(opts.minInterval ?? HOUR),
      opts.feeBps ?? 50,
      15_000,
    )
    .accountsPartial({
      authority: payer.publicKey,
      protocol,
      stablecoin: mint,
      treasury,
      liquidityVault,
      collateralVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([payer])
    .rpc();

  /** Register a merchant, activate it, and give it a payout account. */
  async function newMerchant(name = "Test Merchant", maxOrder = 5_000 * USDC) {
    const authority = await wallet();
    const payout = await tokenAccount(authority.publicKey);
    const merchant = merchantOf(authority.publicKey);

    await program.methods
      .registerMerchant(name, "https://example.test/m.json")
      .accountsPartial({
        authority: authority.publicKey,
        protocol,
        merchant,
        payout,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await program.methods
      .setMerchantActive(true)
      .accountsPartial({ authority: payer.publicKey, protocol, merchant })
      .signers([payer])
      .rpc();

    await program.methods
      .setMerchantMaxOrder(new BN(maxOrder))
      .accountsPartial({ authority: payer.publicKey, protocol, merchant })
      .signers([payer])
      .rpc();

    return { authority, payout, merchant };
  }

  /** Seed the pool merchants are paid from. */
  async function fundLiquidity(amount: number) {
    const funderAta = await tokenAccount(payer.publicKey, amount);
    await program.methods
      .fundLiquidity(new BN(amount))
      .accountsPartial({
        funder: payer.publicKey,
        protocol,
        from: funderAta,
        liquidityVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payer])
      .rpc();
    return funderAta;
  }

  /** A borrower with tokens and a standing delegation to the protocol. */
  async function newBorrower(balance = 1_000 * USDC, delegated = 1_000 * USDC) {
    const kp = await wallet();
    const ata = await tokenAccount(kp.publicKey, balance);
    if (delegated > 0) await delegate(kp, ata, delegated);
    return { kp, ata, profile: profileOf(kp.publicKey) };
  }

  return {
    context,
    provider,
    program,
    payer,
    mint,
    treasury,
    treasuryOwner,
    protocol,
    liquidityVault,
    collateralVault,
    profileOf,
    loanOf,
    merchantOf,
    planOf,
    subOf,
    paymentOf,
    orderRef,
    send,
    wallet,
    fundSol,
    tokenAccount,
    mintTo,
    delegate,
    revoke,
    readToken,
    now,
    warpBy,
    tick,
    newMerchant,
    fundLiquidity,
    newBorrower,
  };
}

/** Assert a transaction failed, and that it failed for the expected reason. */
export async function expectError(p: Promise<any>, code: string) {
  try {
    await p;
  } catch (e: any) {
    const s = JSON.stringify(e?.logs ?? "") + String(e?.message ?? e);
    if (!s.includes(code)) {
      throw new Error(`expected error ${code}, got: ${s.slice(0, 600)}`);
    }
    return;
  }
  throw new Error(`expected error ${code}, but the transaction succeeded`);
}
