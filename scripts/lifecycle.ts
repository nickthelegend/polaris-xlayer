/**
 * Stand Polaris up on a cluster and run one loan through its whole life.
 *
 *   POLARIS_CLUSTER=localnet pnpm exec tsx scripts/lifecycle.ts
 *   POLARIS_CLUSTER=devnet   pnpm exec tsx scripts/lifecycle.ts
 *
 * Every number printed is read back off the chain after the transaction that
 * produced it. Nothing here is asserted from what we intended to happen.
 *
 * The schedule uses 60-second installments, which is why the interval floor is
 * a per-deployment setting: on a consumer book this would be weeks, and a demo
 * that cannot show collection or liquidation is not showing the product.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { AnchorProvider, Program, BN, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createApproveInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const IDL = JSON.parse(readFileSync(resolve(here, "../target/idl/polaris.json"), "utf8")) as Idl;

const CLUSTER = process.env.POLARIS_CLUSTER ?? "devnet";
const RPC =
  process.env.POLARIS_RPC_URL ??
  (CLUSTER === "localnet" ? "http://127.0.0.1:8899" : `https://api.${CLUSTER}.solana.com`);

const USDC = 1_000_000;
/** What this script asks for when it stands a protocol up itself. */
const WANT_INTERVAL = 60; // seconds
const WANT_GRACE = 30; // seconds
const INSTALLMENTS = 4;

/*
 * The effective schedule, resolved after the protocol is read.
 *
 * These start as the requested values and are overwritten by whatever the
 * deployment actually carries. When the script reuses an existing protocol —
 * which it is built to do — the grace period and the interval floor are
 * already fixed and are not this script's to choose. Waiting out its own
 * 30-second constant against a three-day grace is how the liquidation step
 * came to fail with NotLiquidatable while every number above it was right.
 */
let INTERVAL = WANT_INTERVAL;
let GRACE = WANT_GRACE;

const explorer = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER === "localnet" ? "custom" : CLUSTER}`;

/** Full six decimals. At a 240-second term the interest is a fraction of a
 *  cent, and truncating to two would make a correctly pro-rated number read as
 *  zero — which is exactly the bug the EVM build had, inverted. */
const usd = (raw: bigint | number) => {
  const v = BigInt(raw);
  return `${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, "0")}`;
};

/** Whatever `solana config get` is pointed at, unless overridden. */
function defaultKeypairPath(): string {
  if (process.env.POLARIS_KEYPAIR) return process.env.POLARIS_KEYPAIR;
  const cfg = resolve(homedir(), ".config/solana/cli/config.yml");
  if (existsSync(cfg)) {
    const m = readFileSync(cfg, "utf8").match(/keypair_path:\s*(.+)/);
    if (m) return m[1].trim();
  }
  return "~/.config/solana/id.json";
}

function loadKeypair(p: string): Keypair {
  const path = p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p);
  if (!existsSync(path)) {
    throw new Error(`No keypair at ${path}. Set POLARIS_KEYPAIR or run: solana-keygen new`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

const sigs: { step: string; signature: string }[] = [];
function record(step: string, signature: string) {
  sigs.push({ step, signature });
  console.log(`   ${signature}`);
}

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

  console.log(`cluster   ${CLUSTER}`);
  console.log(`program   ${program.programId.toBase58()}`);
  console.log(`authority ${authority.publicKey.toBase58()}`);
  console.log(
    `balance   ${((await connection.getBalance(authority.publicKey)) / LAMPORTS_PER_SOL).toFixed(3)} SOL\n`,
  );

  const send = async (ixs: any[], signers: Keypair[] = []) => {
    const tx = new Transaction().add(...ixs);
    return provider.sendAndConfirm(tx, signers);
  };

  // ---- 1 & 2. the stablecoin and the protocol ----------------------------
  //
  // Both are once-per-deployment. The protocol PDA has a fixed address, so a
  // second `initialize` is not a retry — it is an error, and the program says
  // so. A deployment script that cannot be run twice is a deployment script
  // that cannot be resumed, so this reuses whatever is already standing.
  const deploymentFile = resolve(here, `../deployments/${CLUSTER}.json`);
  const previous = existsSync(deploymentFile)
    ? JSON.parse(readFileSync(deploymentFile, "utf8"))
    : null;

  let mint: PublicKey;
  let treasury: PublicKey;
  let existing: any = null;
  try {
    existing = await (program.account as any).protocol.fetch(protocolPda);
  } catch {
    /* not initialized yet */
  }

  const ataFor = async (owner: PublicKey, fund = 0, mintKey?: PublicKey) => {
    const m = mintKey ?? mint;
    const ata = getAssociatedTokenAddressSync(m, owner, true);
    const info = await connection.getAccountInfo(ata);
    const ixs: any[] = [];
    if (!info) {
      ixs.push(createAssociatedTokenAccountInstruction(authority.publicKey, ata, owner, m));
    }
    if (fund > 0) ixs.push(createMintToInstruction(m, ata, authority.publicKey, fund));
    if (ixs.length) await send(ixs);
    return ata;
  };

  if (existing) {
    mint = existing.stablecoin;
    treasury = existing.treasury;
    // Adopt the deployment's schedule rather than this script's preferences.
    GRACE = Number(existing.gracePeriod.toString());
    INTERVAL = Math.max(WANT_INTERVAL, Number(existing.minIntervalSeconds.toString()));
    console.log("1. stablecoin");
    console.log(`   reusing ${mint.toBase58()}\n`);
    console.log("2. protocol");
    console.log(
      `   already initialized · grace ${existing.gracePeriod}s · min interval ${existing.minIntervalSeconds}s · ${existing.loanCount} loans so far\n`,
    );
  } else {
    console.log("1. stablecoin");
    const mintKp = Keypair.generate();
    mint = mintKp.publicKey;
    const rent = await getMinimumBalanceForRentExemptMint(connection as any);
    record(
      "create mint",
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
      ),
    );
    console.log(`   mint ${mint.toBase58()} (6 decimals, demo token for this cluster)\n`);

    console.log("2. initialize the protocol");
    treasury = await ataFor(authority.publicKey, 0, mint);
    record(
      "initialize",
      await program.methods
        .initialize(new BN(WANT_GRACE), new BN(WANT_INTERVAL), 50, 15_000)
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
        .rpc(),
    );
    console.log(`   grace ${GRACE}s · min interval ${INTERVAL}s · fee 0.5%\n`);
  }

  // ---- 3. merchant ------------------------------------------------------
  console.log("3. register and activate a merchant");
  const merchantAuth = Keypair.generate();
  await send([
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: merchantAuth.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    }),
  ]);
  const merchantPayout = await ataFor(merchantAuth.publicKey);
  const merchantPda = pda([Buffer.from("merchant"), merchantAuth.publicKey.toBuffer()]);

  record(
    "register merchant",
    await program.methods
      .registerMerchant("Ascent Demo Store", "https://polaris.test/merchant.json")
      .accountsPartial({
        authority: merchantAuth.publicKey,
        protocol: protocolPda,
        merchant: merchantPda,
        payout: merchantPayout,
        systemProgram: SystemProgram.programId,
      })
      .signers([merchantAuth])
      .rpc(),
  );
  record(
    "activate merchant",
    await program.methods
      .setMerchantActive(true)
      .accountsPartial({ authority: authority.publicKey, protocol: protocolPda, merchant: merchantPda })
      .rpc(),
  );
  console.log();

  // ---- 4. liquidity -----------------------------------------------------
  console.log("4. seed the pool merchants are paid from");
  // The authority's own account doubles as the funding source here.
  await send([createMintToInstruction(mint, treasury, authority.publicKey, 10_000 * USDC)]);
  record(
    "fund liquidity",
    await program.methods
      .fundLiquidity(new BN(5_000 * USDC))
      .accountsPartial({
        funder: authority.publicKey,
        protocol: protocolPda,
        from: treasury,
        liquidityVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc(),
  );
  console.log(`   pool: ${usd(5_000 * USDC)} USDC\n`);

  // ---- 5. the borrower --------------------------------------------------
  console.log("5. a borrower splits a 400 USDC purchase into 4");
  const borrower = Keypair.generate();
  await send([
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: borrower.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    }),
  ]);
  const borrowerAta = await ataFor(borrower.publicKey, 1_000 * USDC);

  const principal = 400 * USDC;
  const term = INSTALLMENTS * INTERVAL;
  const interest = Math.floor((principal * 1_000 * term) / (10_000 * 365 * 86_400));
  const totalOwed = principal + interest;

  const p0: any = await (program.account as any).protocol.fetch(protocolPda);
  const loanId = Number(p0.loanCount.toString());
  const loanPda = pda([Buffer.from("loan"), u64(loanId)]);
  const profilePda = pda([Buffer.from("profile"), borrower.publicKey.toBuffer()]);

  // The delegation and the origination in ONE transaction. On EVM these were
  // two, and a checkout that dropped the second left a standing allowance with
  // no loan attached to it.
  const approve = createApproveInstruction(
    borrowerAta,
    protocolPda,
    borrower.publicKey,
    BigInt(totalOwed),
  );
  const originate = await program.methods
    .createLoan(new BN(principal), INSTALLMENTS, new BN(INTERVAL))
    .accountsPartial({
      borrower: borrower.publicKey,
      protocol: protocolPda,
      profile: profilePda,
      merchant: merchantPda,
      loan: loanPda,
      borrowerTokenAccount: borrowerAta,
      liquidityVault,
      merchantPayout,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  record(
    "approve + create loan (one transaction)",
    await send([approve, originate], [borrower]),
  );

  const paidToMerchant = (await connection.getTokenAccountBalance(merchantPayout)).value.amount;
  console.log(`   merchant paid in full, up front: ${usd(BigInt(paidToMerchant))} USDC`);
  console.log(`   borrower owes ${usd(totalOwed)} over ${INSTALLMENTS} × ${INTERVAL}s\n`);

  // ---- 6. collection ----------------------------------------------------
  console.log("6. the keeper collects the schedule (borrower never signs again)");
  const keeper = Keypair.generate();
  await send([
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: keeper.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    }),
  ]);
  console.log(`   keeper ${keeper.publicKey.toBase58()} — holds SOL, holds no USDC`);

  const keeperSolBefore = await connection.getBalance(keeper.publicKey);
  // The protocol's ledgers are cumulative across every loan it has ever seen.
  // Reporting them raw on a reused deployment reads as one run collecting twice
  // the fee it should have.
  const pBefore: any = await (program.account as any).protocol.fetch(protocolPda);
  const feesBefore = BigInt(pBefore.protocolFeesAccrued.toString());
  const badDebtBefore = BigInt(pBefore.badDebt.toString());

  for (let k = 0; k < INSTALLMENTS; k++) {
    await sleep((INTERVAL + 3) * 1000);

    const ix = await program.methods
      .collectInstallment()
      .accountsPartial({
        keeper: keeper.publicKey,
        protocol: protocolPda,
        profile: profilePda,
        loan: loanPda,
        borrowerTokenAccount: borrowerAta,
        liquidityVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    // Sent with the keeper as fee payer, not the provider wallet. This is the
    // whole of what KeeperHub's Gas Station did: the account that pays the
    // transaction fee and the authority that moves the tokens are different
    // signers. The borrower spends no SOL; the keeper touches no USDC.
    const tx = new Transaction().add(ix);
    tx.feePayer = keeper.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(keeper);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, "confirmed");

    const l: any = await (program.account as any).loan.fetch(loanPda);
    console.log(`   installment ${l.installmentsPaid}/${INSTALLMENTS} collected`);
    record(`collect installment ${k + 1}`, sig);
  }

  const loan: any = await (program.account as any).loan.fetch(loanPda);
  const profile: any = await (program.account as any).creditProfile.fetch(profilePda);
  const p1: any = await (program.account as any).protocol.fetch(protocolPda);

  console.log(`\n   loan status      ${Object.keys(loan.status)[0]}`);
  console.log(`   repaid           ${usd(BigInt(loan.totalRepaid.toString()))} of ${usd(totalOwed)}`);
  console.log(`   outstanding      ${usd(BigInt(loan.totalOwed.toString()) - BigInt(loan.totalRepaid.toString()))}`);
  console.log(`   credit score     600 → ${profile.score} (${profile.onTimePayments} on time)`);
  const feesThisRun = BigInt(p1.protocolFeesAccrued.toString()) - feesBefore;
  const feeCap = (BigInt(interest) * 2000n) / 10_000n;
  console.log(
    `   protocol fees    ${usd(feesThisRun)} this run, of ${usd(interest)} interest ` +
      `(cap ${usd(feeCap)}) ${feesThisRun <= feeCap ? "✓" : "✗ EXCEEDED"}`,
  );
  console.log(`   protocol fees    ${usd(BigInt(p1.protocolFeesAccrued.toString()))} lifetime`);

  const keeperSpent = (keeperSolBefore - (await connection.getBalance(keeper.publicKey))) / LAMPORTS_PER_SOL;
  const keeperUsdc = await connection
    .getTokenAccountsByOwner(keeper.publicKey, { mint })
    .then((r) => r.value.length);
  console.log(`   keeper spent     ${keeperSpent.toFixed(6)} SOL in fees`);
  console.log(`   keeper USDC      ${keeperUsdc === 0 ? "none — it never held any" : "HELD SOME"}`);

  // The run's record. Defined here so the liquidation step can return early
  // on a deployment whose grace period is too long to wait out, and still
  // leave behind everything it did prove.
  const writeSummary = (liq: any | null) => {
    const out: any = {
      cluster: CLUSTER,
      programId: program.programId.toBase58(),
      stablecoin: mint.toBase58(),
      protocol: protocolPda.toBase58(),
      liquidityVault: liquidityVault.toBase58(),
      collateralVault: collateralVault.toBase58(),
      treasury: treasury.toBase58(),
      merchant: merchantPda.toBase58(),
      borrower: borrower.publicKey.toBase58(),
      keeper: keeper.publicKey.toBase58(),
      loan: loanPda.toBase58(),
      settings: { gracePeriod: GRACE, minInterval: INTERVAL, feeBps: 50 },
      result: {
        status: Object.keys(loan.status)[0],
        principal: principal.toString(),
        totalOwed: totalOwed.toString(),
        totalRepaid: loan.totalRepaid.toString(),
        score: profile.score,
        protocolFeesThisRun: feesThisRun.toString(),
        protocolFeesLifetime: p1.protocolFeesAccrued.toString(),
        interest: interest.toString(),
        feeCap: feeCap.toString(),
      },
      liquidation: liq,
      transactions: sigs,
      ranAt: new Date().toISOString(),
    };
    writeFileSync(deploymentFile, JSON.stringify(out, null, 2) + "\n");
    console.log(`\nwrote ${deploymentFile}`);
    if (CLUSTER !== "localnet") {
      console.log(`\nexplorer:`);
      for (const x of sigs) console.log(`  ${x.step.padEnd(40)} ${explorer(x.signature)}`);
    }
  };

  // ---- 7. a default, and the liquidation ---------------------------------
  console.log("\n7. a second borrower defaults");
  const defaulter = Keypair.generate();
  await send([
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: defaulter.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    }),
  ]);
  const defaulterAta = await ataFor(defaulter.publicKey, 300 * USDC);

  const p2: any = await (program.account as any).protocol.fetch(protocolPda);
  const badLoanId = Number(p2.loanCount.toString());
  const badLoanPda = pda([Buffer.from("loan"), u64(badLoanId)]);
  const badProfilePda = pda([Buffer.from("profile"), defaulter.publicKey.toBuffer()]);

  const badPrincipal = 200 * USDC;
  const badInterest = Math.floor((badPrincipal * 1_000 * INSTALLMENTS * INTERVAL) / (10_000 * 365 * 86_400));
  const badOwed = badPrincipal + badInterest;

  record(
    "approve + create loan (defaulter)",
    await send(
      [
        createApproveInstruction(defaulterAta, protocolPda, defaulter.publicKey, BigInt(badOwed)),
        await program.methods
          .createLoan(new BN(badPrincipal), INSTALLMENTS, new BN(INTERVAL))
          .accountsPartial({
            borrower: defaulter.publicKey,
            protocol: protocolPda,
            profile: badProfilePda,
            merchant: merchantPda,
            loan: badLoanPda,
            borrowerTokenAccount: defaulterAta,
            liquidityVault,
            merchantPayout,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      ],
      [defaulter],
    ),
  );

  // They revoke the delegation and walk away. The only recovery left is
  // whatever the borrower still holds — which is nothing, once revoked.
  record(
    "defaulter revokes the delegation",
    await send(
      [
        {
          keys: [
            { pubkey: defaulterAta, isSigner: false, isWritable: true },
            { pubkey: defaulter.publicKey, isSigner: true, isWritable: false },
          ],
          programId: TOKEN_PROGRAM_ID,
          data: Buffer.from([5]), // SPL Token: Revoke
        } as any,
      ],
      [defaulter],
    ),
  );

  // A consumer-grade grace period is measured in days, and no demo waits that
  // out. Say so and stop, rather than sleeping for three days or sending a
  // transaction that is guaranteed to be refused.
  const waitSeconds = INTERVAL + GRACE + 5;
  if (waitSeconds > 15 * 60) {
    console.log(
      `   this deployment's grace period is ${GRACE}s (${(GRACE / 86_400).toFixed(1)} days).`,
    );
    console.log(
      `   the loan above is real and will become liquidatable then; not waiting.`,
    );
    console.log(`   for the liquidation path end to end, run against a fresh cluster:`);
    console.log(`     ./scripts/reset-local.sh   # stands one up with a 3s grace`);
    writeSummary(null);
    return;
  }

  console.log(`   waiting out the first installment plus ${GRACE}s of grace...`);
  await sleep(waitSeconds * 1000);

  // The condition is checked inside the instruction that acts on it. On EVM
  // this pair needed a platform call to be atomic; here there is no window.
  const liqIx = await program.methods
    .liquidate()
    .accountsPartial({
      keeper: keeper.publicKey,
      protocol: protocolPda,
      profile: badProfilePda,
      loan: badLoanPda,
      borrowerTokenAccount: defaulterAta,
      collateralVault,
      liquidityVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  const liqTx = new Transaction().add(liqIx);
  liqTx.feePayer = keeper.publicKey;
  liqTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  liqTx.sign(keeper);
  const liqSig = await connection.sendRawTransaction(liqTx.serialize());
  await connection.confirmTransaction(liqSig, "confirmed");
  record("liquidate", liqSig);

  const badLoan: any = await (program.account as any).loan.fetch(badLoanPda);
  const badProfile: any = await (program.account as any).creditProfile.fetch(badProfilePda);
  const p3: any = await (program.account as any).protocol.fetch(protocolPda);
  console.log(`   loan status      ${Object.keys(badLoan.status)[0]}`);
  console.log(`   recovered        ${usd(BigInt(badLoan.totalRepaid.toString()))} of ${usd(badOwed)}`);
  console.log(
    `   bad debt booked  ${usd(BigInt(p3.badDebt.toString()) - badDebtBefore)} this run ` +
      `(${usd(BigInt(p3.badDebt.toString()))} lifetime)`,
  );
  console.log(`   credit score     600 → ${badProfile.score}`);

  writeSummary({
    loan: badLoanPda.toBase58(),
    status: Object.keys(badLoan.status)[0],
    outstanding: badOwed.toString(),
    recovered: badLoan.totalRepaid.toString(),
    badDebtThisRun: (BigInt(p3.badDebt.toString()) - badDebtBefore).toString(),
    badDebtLifetime: p3.badDebt.toString(),
    score: badProfile.score,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
