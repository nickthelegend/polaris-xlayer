/**
 * The SDK, exercised for real.
 *
 * Every function `createPolaris()` returns is called here against a running
 * cluster with a real deployed program, and the result is checked against chain
 * state rather than against a return value. The SDK typechecked for a long
 * time without a single line of it ever having executed, which is not the same
 * thing as working — this file is the difference.
 *
 *   ./scripts/reset-local.sh          # stand up a cluster and seed it
 *   pnpm --filter @polaris/sdk-solana test
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorProvider, type Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { createPolaris, orderRef, quoteInstallments, type Polaris } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const CLUSTER = process.env.POLARIS_CLUSTER ?? "localnet";

const seed = JSON.parse(
  readFileSync(resolve(root, `deployments/${CLUSTER}-seed.json`), "utf8"),
);
const idl = JSON.parse(
  readFileSync(resolve(root, "target/idl/polaris.json"), "utf8"),
) as Idl;

const USDC = 1_000_000;

/** Anchor only needs three members; nothing here uses a filesystem wallet. */
class Signer {
  // Written out rather than a parameter property: this file runs under
  // `node --experimental-strip-types`, which rejects those outright.
  payer: Keypair;
  constructor(payer: Keypair) {
    this.payer = payer;
  }
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction(tx: any) {
    tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions(txs: any[]) {
    return Promise.all(txs.map((t) => this.signTransaction(t)));
  }
}

function loadAuthority(): Keypair {
  const cfg = resolve(homedir(), ".config/solana/cli/config.yml");
  const path =
    process.env.POLARIS_KEYPAIR ??
    readFileSync(cfg, "utf8").match(/keypair_path:\s*(.+)/)![1].trim();
  const p = path.startsWith("~") ? resolve(homedir(), path.slice(2)) : path;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

describe("@polaris/sdk-solana against a live cluster", () => {
  const connection = new Connection(seed.rpc, "confirmed");
  const mint = new PublicKey(seed.stablecoin);
  const borrower = Keypair.generate();
  let polaris: Polaris;
  let merchant: PublicKey;

  before(async () => {
    const authority = loadAuthority();
    const ata = getAssociatedTokenAddressSync(mint, borrower.publicKey, true);

    // Fund the borrower: fees and stablecoin.
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: borrower.publicKey,
        lamports: 2 * LAMPORTS_PER_SOL,
      }),
      createAssociatedTokenAccountInstruction(authority.publicKey, ata, borrower.publicKey, mint),
      createMintToInstruction(mint, ata, authority.publicKey, 5_000 * USDC),
    );
    tx.feePayer = authority.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(authority);
    await connection.confirmTransaction(
      await connection.sendRawTransaction(tx.serialize()),
      "confirmed",
    );

    polaris = createPolaris({
      connection,
      wallet: new Signer(borrower),
      idl,
    });
    merchant = new PublicKey(seed.merchants[0].pda);
  });

  it("reads protocol config off the chain", async () => {
    const p = await polaris.protocol();
    assert.equal(p.stablecoin.toBase58(), seed.stablecoin);
    assert.ok(Number(p.loanCount.toString()) >= 0);
  });

  it("derives a credit line for a borrower with no history", async () => {
    const line = await polaris.creditLine();
    // The program's own defaults: a fresh profile scores 600, which is the
    // 500 USDC band, with nothing owed.
    assert.equal(line.score, 600);
    assert.equal(line.baseLimit, 500_000_000n);
    assert.equal(line.activeDebt, 0n);
    assert.equal(line.available, 500_000_000n);
  });

  it("quotes a plan the way the program computes it", async () => {
    const q = await polaris.quote({ amount: BigInt(240 * USDC) });
    assert.equal(q.totalOwed, 241_841_095n);
    assert.equal(q.interest, 1_841_095n);
    assert.equal(q.schedule.length, 4);
    // The ceiling ladder: every threshold rounds up and the last lands exactly.
    assert.equal(q.schedule[3].cumulative, q.totalOwed);
    assert.equal(
      q.schedule.reduce((a, s) => a + s.amount, 0n),
      q.totalOwed,
    );
  });

  it("refuses a plan above the limit before sending anything", async () => {
    const verdict = await polaris.canPayLater({ amount: BigInt(5_000 * USDC) });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason!, /credit/);
  });

  it("pays a merchant in full", async () => {
    const before = (await connection.getTokenAccountBalance(
      new PublicKey(seed.merchants[0].payout),
    )).value.amount;

    const sig = await polaris.pay({
      merchant,
      amount: BigInt(20 * USDC),
      orderId: `SDK-${Date.now().toString(36)}`,
    });
    assert.ok(sig.length > 60, "no signature returned");

    const after = (await connection.getTokenAccountBalance(
      new PublicKey(seed.merchants[0].payout),
    )).value.amount;
    // 20.00 less the 0.5% protocol fee.
    assert.equal(Number(after) - Number(before), 19_900_000);
  });

  it("refuses the same order twice", async () => {
    const orderId = `SDK-DUP-${Date.now().toString(36)}`;
    await polaris.pay({ merchant, amount: BigInt(5 * USDC), orderId });
    await assert.rejects(
      () => polaris.pay({ merchant, amount: BigInt(5 * USDC), orderId }),
      /already in use|custom program error/i,
    );
  });

  it("splits a purchase into four, in one transaction", async () => {
    const { signature, loanId, quote } = await polaris.payLater({
      merchant,
      amount: BigInt(120 * USDC),
    });
    assert.ok(signature.length > 60);

    // The approval and the origination land together or not at all.
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    const logs = (tx?.meta?.logMessages ?? []).join("\n");
    assert.match(logs, /Instruction: Approve/);
    assert.match(logs, /Instruction: CreateLoan/);

    const loan: any = await (polaris.program.account as any).loan.fetch(
      polaris.pdas.loanOf(loanId),
    );
    assert.equal(loan.totalOwed.toString(), quote.totalOwed.toString());
    assert.equal(loan.installmentCount, 4);
    assert.equal(loan.installmentsPaid, 0);
  });

  it("reflects the new debt in the credit line", async () => {
    const line = await polaris.creditLine();
    assert.ok(line.activeDebt > 0n, "the loan did not register as debt");
    assert.equal(line.available, line.limit - line.activeDebt);
  });

  it("repays an arbitrary amount", async () => {
    const p = await polaris.protocol();
    const loanId = Number(p.loanCount.toString()) - 1;
    const before: any = await (polaris.program.account as any).loan.fetch(
      polaris.pdas.loanOf(loanId),
    );

    await polaris.repay({ loanId, amount: BigInt(10 * USDC) });

    const after: any = await (polaris.program.account as any).loan.fetch(
      polaris.pdas.loanOf(loanId),
    );
    assert.equal(
      Number(after.totalRepaid.toString()) - Number(before.totalRepaid.toString()),
      10 * USDC,
    );
  });

  it("locks collateral and raises the limit by the multiplier", async () => {
    const before = await polaris.creditLine();
    await polaris.lockCollateral({ amount: BigInt(100 * USDC) });
    const after = await polaris.creditLine();

    assert.equal(after.lockedCollateral, before.lockedCollateral + BigInt(100 * USDC));
    // 150% of what was locked.
    assert.equal(after.collateralBoost - before.collateralBoost, BigInt(150 * USDC));
    assert.equal(after.limit - before.limit, BigInt(150 * USDC));
  });

  it("subscribes and then cancels unilaterally", async () => {
    const plans = await (polaris.program.account as any).plan.all();
    const plan = plans.find((p: any) => p.account.active);
    assert.ok(plan, "the seeded cluster has no active plan");

    const sig = await polaris.subscribe({ plan: plan.publicKey });
    assert.ok(sig.length > 60);

    const subPda = polaris.pdas.subOf(borrower.publicKey, plan.publicKey);
    let sub: any = await (polaris.program.account as any).subscription.fetch(subPda);
    assert.equal(Object.keys(sub.status)[0], "active");
    assert.equal(sub.periodsCharged, 1, "period one was not charged at signup");

    await polaris.cancelSubscription({ plan: plan.publicKey });
    sub = await (polaris.program.account as any).subscription.fetch(subPda);
    assert.equal(Object.keys(sub.status)[0], "cancelled");
  });

  it("builds an order reference that cannot collide", () => {
    // Short ids go in directly, right-aligned; long ones are hashed rather
    // than truncated, or two orders sharing a prefix would be one order.
    assert.equal(orderRef("A").length, 32);
    const long1 = "order-" + "x".repeat(40) + "-A";
    const long2 = "order-" + "x".repeat(40) + "-B";
    assert.notDeepEqual(orderRef(long1), orderRef(long2));
    assert.deepEqual(orderRef("ORD-1"), orderRef("ORD-1"));
  });

  it("quotes identically whether or not a connection is involved", () => {
    const offline = quoteInstallments({
      principal: BigInt(240 * USDC),
      installmentCount: 4,
      intervalSeconds: 7 * 86_400,
    });
    assert.equal(offline.totalOwed, 241_841_095n);
  });
});
