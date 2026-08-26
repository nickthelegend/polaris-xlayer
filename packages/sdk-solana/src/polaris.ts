/**
 * Three ways to pay, one call each.
 *
 *   const polaris = createPolaris({ connection, wallet, idl });
 *
 *   await polaris.pay({ merchant, amount: 25_000_000n, orderId });   // in full
 *   await polaris.subscribe({ plan });                               // recurring
 *   await polaris.payLater({ merchant, amount: 200_000_000n });      // 4 installments
 *
 * The interesting one is `payLater`.
 *
 * On EVM this was two transactions the borrower had to send in order: approve
 * the loan engine for the full repayment amount, wait for it to confirm, then
 * originate. In between, the approval sat on chain doing nothing, and a
 * checkout that dropped the second transaction left a standing allowance behind
 * with no loan attached to it.
 *
 * Solana puts both instructions in one transaction. The SPL `Approve` and the
 * origination either both land or neither does, the borrower signs once, and
 * there is no window in which one exists without the other. The permissioned
 * originator role the EVM build needed goes away with it.
 */

import { AnchorProvider, Program, BN, type Idl } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createApproveInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  creditLimitFor,
  derivePdas,
  orderRef,
  quoteInstallments,
  type CreditLine,
  type Quote,
} from "./credit.ts";

export type PolarisConfig = {
  connection: Connection;
  /** Anything Anchor accepts as a wallet: an adapter, or a NodeWallet. */
  wallet: any;
  idl: Idl;
  commitment?: "processed" | "confirmed" | "finalized";
};

export type Polaris = ReturnType<typeof createPolaris>;

export function createPolaris(config: PolarisConfig) {
  const provider = new AnchorProvider(config.connection, config.wallet, {
    commitment: config.commitment ?? "confirmed",
  });
  const program = new Program(config.idl, provider);
  const pdas = derivePdas(program.programId);
  const me = (): PublicKey => provider.wallet.publicKey;

  async function protocol(): Promise<any> {
    return (program.account as any).protocol.fetch(pdas.protocol);
  }

  async function tokenAccountFor(owner: PublicKey): Promise<PublicKey> {
    const p = await protocol();
    return getAssociatedTokenAddressSync(p.stablecoin, owner, true);
  }

  /**
   * The borrower's credit line.
   *
   * One account fetch, because score, active debt and locked collateral are
   * three fields on one account here rather than three EVM contracts that had
   * to be read separately and kept consistent with each other.
   */
  async function creditLine(user?: PublicKey): Promise<CreditLine> {
    const who = user ?? me();
    const p = await protocol();
    let profile: any;
    try {
      profile = await (program.account as any).creditProfile.fetch(pdas.profileOf(who));
    } catch {
      // No profile yet means no history: the starting score, no debt.
      profile = { score: 600, activeDebt: new BN(0), lockedCollateral: new BN(0) };
    }
    return creditLimitFor(
      {
        score: profile.score,
        activeDebt: BigInt(profile.activeDebt.toString()),
        lockedCollateral: BigInt(profile.lockedCollateral.toString()),
      },
      p.creditMultiplierBps,
    );
  }

  /** What a plan would cost, without committing to it. */
  async function quote(params: {
    amount: bigint;
    installmentCount?: number;
    intervalSeconds?: number;
  }): Promise<Quote> {
    return quoteInstallments({
      principal: params.amount,
      installmentCount: params.installmentCount ?? 4,
      intervalSeconds: params.intervalSeconds ?? 7 * 86_400,
    });
  }

  /** Whether this borrower can split this purchase right now, and why not. */
  async function canPayLater(params: {
    amount: bigint;
    installmentCount?: number;
    intervalSeconds?: number;
  }): Promise<{ ok: boolean; reason?: string; quote: Quote; credit: CreditLine }> {
    const q = await quote(params);
    const credit = await creditLine();
    if (q.totalOwed > credit.available) {
      return {
        ok: false,
        reason: `Needs ${q.totalOwed} of credit; ${credit.available} available.`,
        quote: q,
        credit,
      };
    }
    return { ok: true, quote: q, credit };
  }

  // -----------------------------------------------------------------------

  /** Pay a merchant in full, now. */
  async function pay(params: {
    merchant: PublicKey;
    amount: bigint;
    orderId: string;
    payerTokenAccount?: PublicKey;
  }): Promise<string> {
    const p = await protocol();
    const merchant: any = await (program.account as any).merchant.fetch(params.merchant);
    const ref = orderRef(params.orderId);

    return program.methods
      .pay(new BN(params.amount.toString()), Array.from(ref))
      .accountsPartial({
        payer: me(),
        protocol: pdas.protocol,
        merchant: params.merchant,
        payment: pdas.paymentOf(params.merchant, ref),
        payerTokenAccount: params.payerTokenAccount ?? (await tokenAccountFor(me())),
        merchantPayout: merchant.payout,
        treasury: p.treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Split a purchase into installments, and pay the merchant now.
   *
   * The delegation and the origination go in one transaction. The delegation is
   * sized against **everything** the borrower owes, not just this plan: one
   * delegate slot backs every open plan at once, so sizing it for a single
   * purchase would leave the next collection short.
   */
  async function payLater(params: {
    merchant: PublicKey;
    amount: bigint;
    installmentCount?: number;
    intervalSeconds?: number;
    borrowerTokenAccount?: PublicKey;
  }): Promise<{ signature: string; loanId: number; quote: Quote }> {
    const installmentCount = params.installmentCount ?? 4;
    const intervalSeconds = params.intervalSeconds ?? 7 * 86_400;

    const p = await protocol();
    const merchant: any = await (program.account as any).merchant.fetch(params.merchant);
    const ata = params.borrowerTokenAccount ?? (await tokenAccountFor(me()));

    const q = await quote({ amount: params.amount, installmentCount, intervalSeconds });
    const credit = await creditLine();
    const required = credit.activeDebt + q.totalOwed;

    const loanId = Number(p.loanCount.toString());

    const approve: TransactionInstruction = createApproveInstruction(
      ata,
      pdas.protocol,
      me(),
      required,
    );

    const originate = await program.methods
      .createLoan(
        new BN(params.amount.toString()),
        installmentCount,
        new BN(intervalSeconds),
      )
      .accountsPartial({
        borrower: me(),
        protocol: pdas.protocol,
        profile: pdas.profileOf(me()),
        merchant: params.merchant,
        loan: pdas.loanOf(loanId),
        borrowerTokenAccount: ata,
        liquidityVault: pdas.liquidityVault,
        merchantPayout: merchant.payout,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    // Both, or neither.
    const tx = new Transaction().add(approve, originate);
    const signature = await provider.sendAndConfirm(tx);
    return { signature, loanId, quote: q };
  }

  /**
   * Subscribe, paying period one immediately.
   *
   * The delegation covers a bounded number of future periods rather than being
   * unlimited, and the subscriber can revoke or cancel at any time without the
   * merchant's cooperation. That combination is what makes a standing
   * authorization safe to grant, and it is the thing recurring crypto payments
   * normally cannot offer.
   */
  async function subscribe(params: {
    plan: PublicKey;
    /** How many periods to authorize up front. Default 12. */
    periods?: number;
    subscriberTokenAccount?: PublicKey;
  }): Promise<string> {
    const periods = params.periods ?? 12;
    const p = await protocol();
    const plan: any = await (program.account as any).plan.fetch(params.plan);
    const merchant: any = await (program.account as any).merchant.fetch(plan.merchant);
    const ata = params.subscriberTokenAccount ?? (await tokenAccountFor(me()));

    const authorize = BigInt(plan.pricePerPeriod.toString()) * BigInt(periods);

    const approve = createApproveInstruction(ata, pdas.protocol, me(), authorize);

    const sub = await program.methods
      .subscribe()
      .accountsPartial({
        subscriber: me(),
        protocol: pdas.protocol,
        merchant: plan.merchant,
        plan: params.plan,
        subscription: pdas.subOf(me(), params.plan),
        subscriberTokenAccount: ata,
        merchantPayout: merchant.payout,
        treasury: p.treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return provider.sendAndConfirm(new Transaction().add(approve, sub));
  }

  /** Cancel. Unilateral — needs no merchant cooperation. */
  async function cancelSubscription(params: { plan: PublicKey }): Promise<string> {
    const plan: any = await (program.account as any).plan.fetch(params.plan);
    const merchant: any = await (program.account as any).merchant.fetch(plan.merchant);
    return program.methods
      .cancelSubscription()
      .accountsPartial({
        signer: me(),
        merchant: plan.merchant,
        plan: params.plan,
        subscription: pdas.subOf(me(), params.plan),
      })
      .rpc();
  }

  /** Pay any amount toward a loan, including paying it off entirely. */
  async function repay(params: {
    loanId: number | bigint;
    amount: bigint;
    borrowerTokenAccount?: PublicKey;
  }): Promise<string> {
    return program.methods
      .repay(new BN(params.amount.toString()))
      .accountsPartial({
        borrower: me(),
        protocol: pdas.protocol,
        profile: pdas.profileOf(me()),
        loan: pdas.loanOf(params.loanId),
        borrowerTokenAccount:
          params.borrowerTokenAccount ?? (await tokenAccountFor(me())),
        liquidityVault: pdas.liquidityVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  /** Lock collateral to raise the limit beyond what the score allows. */
  async function lockCollateral(params: {
    amount: bigint;
    fromTokenAccount?: PublicKey;
  }): Promise<string> {
    return program.methods
      .lockCollateral(new BN(params.amount.toString()))
      .accountsPartial({
        user: me(),
        protocol: pdas.protocol,
        profile: pdas.profileOf(me()),
        from: params.fromTokenAccount ?? (await tokenAccountFor(me())),
        collateralVault: pdas.collateralVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  return {
    program,
    pdas,
    protocol,
    creditLine,
    quote,
    canPayLater,
    pay,
    payLater,
    subscribe,
    cancelSubscription,
    repay,
    lockCollateral,
  };
}
