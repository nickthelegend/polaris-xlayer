/**
 * The keeper's jobs.
 *
 * Each one is a pure pass over its source of truth: read what is due, act, and
 * report what happened. They are safe to run repeatedly and safe to run
 * concurrently with each other, because the program — not the keeper — decides
 * what actually moves.
 *
 * The interesting part is the failure branch. A charge that fails is not
 * retried here. It is handed to the dunning ladder, which decides whether
 * waiting will help, whether the borrower should hear about it, and whether the
 * loan has run out of road and should be liquidated instead.
 */

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import {
  chainNow,
  formatUsdc,
  installmentAmount,
  isInstallmentDue,
  isLiquidatable,
  loadLoans,
  loadSubscriptions,
  type LoanView,
} from "./book.ts";
import type { PolarisKeeperClient, Receipt } from "./client.ts";
import type { KeeperConfig } from "./config.ts";
import { dunningMessage, nextDunningStep } from "./dunning.ts";

export type JobResult = {
  job: string;
  considered: number;
  acted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  receipts: Receipt[];
  notifications: string[];
};

type Ctx = {
  cfg: KeeperConfig;
  client: PolarisKeeperClient;
  log?: (line: string) => void;
  /** Attempts already made per loan/subscription, from wherever you persist it. */
  attemptsOf?: (key: string) => number;
};

const empty = (job: string): JobResult => ({
  job,
  considered: 0,
  acted: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  receipts: [],
  notifications: [],
});

function handleFailure(
  result: JobResult,
  receipt: Receipt,
  key: string,
  attemptsMade: number,
  amount: string,
  log: (s: string) => void,
) {
  result.failed++;
  result.receipts.push(receipt);

  const kind = receipt.error?.kind ?? "would_revert";
  const decision = nextDunningStep({
    attemptsMade,
    failureKind: kind,
    // Only a genuinely unclassified error carries its raw text forward.
    detail: receipt.error?.kind ? undefined : receipt.error?.message,
    now: new Date(),
  });

  if (decision.action === "abandon") {
    log(`   abandoned: ${decision.reason}`);
    return;
  }
  if (decision.action === "escalate") {
    log(`   escalated: ${decision.reason}`);
    return;
  }
  log(`   retry ${decision.stage.label} at ${decision.at.toISOString()}`);
  if (decision.notify) {
    const msg = dunningMessage(kind, decision.stage, amount);
    result.notifications.push(`${key}: ${msg}`);
    log(`   notify borrower: ${msg}`);
  }
}

// ---------------------------------------------------------------------------

/** Collect every installment that is due. */
export async function runCollection(ctx: Ctx): Promise<JobResult> {
  const { cfg, client } = ctx;
  const log = ctx.log ?? console.log;
  const result = empty("collection");

  const now = await chainNow(cfg.program);
  const loans = await loadLoans(cfg.program);
  const due = loans.filter((l) => isInstallmentDue(l, now));
  result.considered = due.length;

  for (const loan of due) {
    const amount = installmentAmount(loan);
    if (amount === 0n) {
      result.skipped++;
      continue;
    }

    const key = `loan:${loan.id}`;
    const pretty = formatUsdc(amount);
    log(`${key} installment ${loan.installmentsPaid + 1}/${loan.installmentCount} — ${pretty}`);

    const ix = await cfg.program.methods
      .collectInstallment()
      .accountsPartial({
        keeper: cfg.keeper.publicKey,
        protocol: cfg.pdas.protocol,
        profile: cfg.pdas.profileOf(loan.borrower),
        loan: loan.address,
        borrowerTokenAccount: loan.borrowerTokenAccount,
        liquidityVault: cfg.pdas.liquidityVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    result.acted++;
    const receipt = await client.execute(
      [ix],
      [loan.address, loan.borrowerTokenAccount, cfg.pdas.liquidityVault],
      { label: `collect ${key}`, dryRun: cfg.dryRun },
    );

    if (receipt.ok) {
      result.succeeded++;
      result.receipts.push(receipt);
      log(`   ${receipt.summary}`);
    } else {
      handleFailure(result, receipt, key, ctx.attemptsOf?.(key) ?? 0, pretty, log);
    }
  }

  return result;
}

/** Charge every subscription period that is due. */
export async function runSubscriptions(ctx: Ctx): Promise<JobResult> {
  const { cfg, client } = ctx;
  const log = ctx.log ?? console.log;
  const result = empty("subscriptions");

  const now = await chainNow(cfg.program);
  const subs = await loadSubscriptions(cfg.program);
  const due = subs.filter((s) => s.status === "active" && now >= s.nextChargeAt);
  result.considered = due.length;

  if (!due.length) return result;

  // One read for the plan and merchant directories, not one per subscription.
  const plans = new Map<string, any>(
    (await (cfg.program.account as any).plan.all()).map((p: any) => [
      p.publicKey.toBase58(),
      p.account,
    ]),
  );
  const merchants = new Map<string, any>(
    (await (cfg.program.account as any).merchant.all()).map((m: any) => [
      m.publicKey.toBase58(),
      m.account,
    ]),
  );
  const protocol = await (cfg.program.account as any).protocol.fetch(cfg.pdas.protocol);

  for (const sub of due) {
    const plan = plans.get(sub.plan.toBase58());
    if (!plan) {
      result.skipped++;
      continue;
    }
    const merchantPda: PublicKey = plan.merchant;
    const merchant = merchants.get(merchantPda.toBase58());
    if (!merchant) {
      result.skipped++;
      continue;
    }

    const key = `sub:${sub.subscriber.toBase58().slice(0, 8)}/${plan.id}`;
    const pretty = formatUsdc(BigInt(plan.pricePerPeriod.toString()));
    log(`${key} period ${sub.periodsCharged + 1} — ${pretty}`);

    const ix = await cfg.program.methods
      .chargeDue()
      .accountsPartial({
        keeper: cfg.keeper.publicKey,
        protocol: cfg.pdas.protocol,
        merchant: merchantPda,
        plan: sub.plan,
        subscription: sub.address,
        subscriberTokenAccount: sub.subscriberTokenAccount,
        merchantPayout: merchant.payout,
        treasury: protocol.treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    result.acted++;
    const receipt = await client.execute(
      [ix],
      [sub.address, sub.subscriberTokenAccount, merchant.payout],
      { label: `charge ${key}`, dryRun: cfg.dryRun },
    );

    if (receipt.ok) {
      result.succeeded++;
      result.receipts.push(receipt);
      log(`   ${receipt.summary}`);
    } else {
      handleFailure(result, receipt, key, ctx.attemptsOf?.(key) ?? 0, pretty, log);
    }
  }

  return result;
}

/** Liquidate every loan that qualifies. */
export async function runLiquidation(ctx: Ctx): Promise<JobResult> {
  const { cfg, client } = ctx;
  const log = ctx.log ?? console.log;
  const result = empty("liquidation");

  const now = await chainNow(cfg.program);
  const protocol = await (cfg.program.account as any).protocol.fetch(cfg.pdas.protocol);
  const grace = Number(protocol.gracePeriod.toString());

  const loans = await loadLoans(cfg.program);
  const candidates = loans.filter((l: LoanView) => isLiquidatable(l, grace, now));
  result.considered = candidates.length;

  for (const loan of candidates) {
    const key = `loan:${loan.id}`;
    const outstanding = loan.totalOwed - loan.totalRepaid;
    log(`${key} liquidatable — ${formatUsdc(outstanding)} outstanding`);

    const ix = await cfg.program.methods
      .liquidate()
      .accountsPartial({
        keeper: cfg.keeper.publicKey,
        protocol: cfg.pdas.protocol,
        profile: cfg.pdas.profileOf(loan.borrower),
        loan: loan.address,
        borrowerTokenAccount: loan.borrowerTokenAccount,
        collateralVault: cfg.pdas.collateralVault,
        liquidityVault: cfg.pdas.liquidityVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    result.acted++;
    // No pre-check here beyond the filter above. The program re-evaluates the
    // condition inside the same instruction that acts on it, so a borrower who
    // repays between our read and our send simply causes a clean refusal
    // rather than an unjust liquidation.
    const receipt = await client.execute(
      [ix],
      [loan.address, loan.borrowerTokenAccount, cfg.pdas.liquidityVault],
      { label: `liquidate ${key}`, dryRun: cfg.dryRun },
    );

    if (receipt.ok) {
      result.succeeded++;
      result.receipts.push(receipt);
      log(`   ${receipt.summary}`);
    } else if (receipt.error?.code === "NotLiquidatable") {
      result.failed--;
      result.skipped++;
      log(`   no longer liquidatable — the borrower paid. Nothing to do.`);
    } else {
      handleFailure(result, receipt, key, 0, formatUsdc(outstanding), log);
    }
  }

  return result;
}
