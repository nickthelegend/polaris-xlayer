/**
 * The paths where a bug costs real money.
 *
 * Every exploit the Solidity build was hardened against has a case here, named
 * for the exploit rather than the function, so a regression reads as "dust buys
 * liquidation immunity again" instead of "repay test 4 failed".
 */
import { assert } from "chai";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { setup, expectError, Harness, USDC, HOUR, DAY, WEEK } from "./harness";

/** Mirrors `math::interest_for` exactly. */
function interestFor(principal: number, termSeconds: number): number {
  return Math.floor((principal * 1000 * termSeconds) / (10_000 * 365 * DAY));
}
/** Mirrors `math::threshold_for` — ceiling division off one canonical ladder. */
function thresholdFor(totalOwed: number, count: number, k: number): number {
  if (k === 0) return 0;
  if (k >= count) return totalOwed;
  return Math.ceil((totalOwed * k) / count);
}

async function createLoan(
  h: Harness,
  borrower: { kp: Keypair; ata: PublicKey; profile: PublicKey },
  m: { merchant: PublicKey; payout: PublicKey },
  principal: number,
  installments: number,
  interval: number,
) {
  const p = await h.program.account.protocol.fetch(h.protocol);
  const loanId = p.loanCount.toNumber();
  const loan = h.loanOf(loanId);

  await h.program.methods
    .createLoan(new BN(principal), installments, new BN(interval))
    .accountsPartial({
      borrower: borrower.kp.publicKey,
      protocol: h.protocol,
      profile: borrower.profile,
      merchant: m.merchant,
      loan,
      borrowerTokenAccount: borrower.ata,
      liquidityVault: h.liquidityVault,
      merchantPayout: m.payout,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([borrower.kp])
    .rpc();

  return { loanId, loan };
}

function collect(h: Harness, loan: PublicKey, borrower: PublicKey, ata: PublicKey) {
  return h.program.methods
    .collectInstallment()
    .accountsPartial({
      keeper: h.payer.publicKey,
      protocol: h.protocol,
      profile: h.profileOf(borrower),
      loan,
      borrowerTokenAccount: ata,
      liquidityVault: h.liquidityVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([h.payer]);
}

function liquidate(h: Harness, loan: PublicKey, borrower: PublicKey, ata: PublicKey) {
  return h.program.methods
    .liquidate()
    .accountsPartial({
      keeper: h.payer.publicKey,
      protocol: h.protocol,
      profile: h.profileOf(borrower),
      loan,
      borrowerTokenAccount: ata,
      collateralVault: h.collateralVault,
      liquidityVault: h.liquidityVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([h.payer]);
}

// ===========================================================================

describe("origination and collection", () => {
  it("pays the merchant in full up front and collects the schedule to zero", async () => {
    const h = await setup({ gracePeriod: DAY });
    await h.fundLiquidity(10_000 * USDC);
    const m = await h.newMerchant();

    const principal = 400 * USDC;
    const interval = 7 * DAY;
    const count = 4;
    const interest = interestFor(principal, count * interval);
    const totalOwed = principal + interest;

    const b = await h.newBorrower(1_000 * USDC, totalOwed);
    const { loan } = await createLoan(h, b, m, principal, count, interval);

    // The merchant has the money now. That is the product.
    assert.equal((await h.readToken(m.payout)).amount, principal);

    let l = await h.program.account.loan.fetch(loan);
    assert.equal(l.totalOwed.toNumber(), totalOwed);
    assert.equal(l.principal.toNumber(), principal);
    assert.deepEqual(l.status, { active: {} });

    let profile = await h.program.account.creditProfile.fetch(b.profile);
    assert.equal(profile.activeDebt.toNumber(), totalOwed);
    assert.equal(profile.score, 600);

    for (let k = 0; k < count; k++) {
      await h.warpBy(interval);
      await collect(h, loan, b.kp.publicKey, b.ata).rpc();

      l = await h.program.account.loan.fetch(loan);
      assert.equal(l.installmentsPaid, k + 1, `installment ${k} did not complete`);
      assert.equal(
        l.totalRepaid.toNumber(),
        thresholdFor(totalOwed, count, k + 1),
        `cumulative repaid wrong after installment ${k}`,
      );
    }

    l = await h.program.account.loan.fetch(loan);
    assert.deepEqual(l.status, { repaid: {} });
    assert.equal(l.totalRepaid.toNumber(), totalOwed);

    profile = await h.program.account.creditProfile.fetch(b.profile);
    assert.equal(profile.activeDebt.toNumber(), 0);
    assert.equal(profile.onTimePayments, 4);
    assert.equal(profile.score, 600 + 4 * 12);

    // The pool got its principal back plus the interest.
    assert.equal((await h.readToken(h.liquidityVault)).amount, 10_000 * USDC - principal + totalOwed);
  });

  it("refuses to collect before the installment is due", async () => {
    const h = await setup();
    await h.fundLiquidity(10_000 * USDC);
    const m = await h.newMerchant();
    const b = await h.newBorrower(1_000 * USDC, 500 * USDC);
    const { loan } = await createLoan(h, b, m, 200 * USDC, 4, 7 * DAY);

    await expectError(collect(h, loan, b.kp.publicKey, b.ata).rpc(), "NotDue");
    await h.warpBy(7 * DAY);
    await collect(h, loan, b.kp.publicKey, b.ata).rpc();
  });

  it("rejects a schedule that never existed", async () => {
    const h = await setup();
    await h.fundLiquidity(10_000 * USDC);
    const m = await h.newMerchant();
    const b = await h.newBorrower(1_000 * USDC, 500 * USDC);

    // A zero interval made the loan interest-free and due in full at
    // origination — liquidatable one grace period later.
    await expectError(createLoan(h, b, m, 100 * USDC, 4, 0), "InvalidInterval");
    await expectError(createLoan(h, b, m, 100 * USDC, 4, HOUR - 1), "InvalidInterval");
    await expectError(createLoan(h, b, m, 100 * USDC, 0, 7 * DAY), "InvalidInstallments");
    await expectError(createLoan(h, b, m, 100 * USDC, 25, 7 * DAY), "InvalidInstallments");
    await expectError(createLoan(h, b, m, 0, 4, 7 * DAY), "ZeroAmount");
  });
});

describe("the exploits the Solidity build was hardened against", () => {
  it("dust cannot buy liquidation immunity", async () => {
    const h = await setup({ gracePeriod: DAY });
    await h.fundLiquidity(10_000 * USDC);
    const m = await h.newMerchant();

    const principal = 200 * USDC;
    const interval = 7 * DAY;
    const interest = interestFor(principal, 4 * interval);
    const totalOwed = principal + interest;

    const b = await h.newBorrower(1_000 * USDC, totalOwed);
    const { loan } = await createLoan(h, b, m, principal, 4, interval);

    // Four one-unit payments. Under the old increment-per-call model this
    // showed 4/4 collected while ~200 USDC was still owed, and — because the
    // liquidation check returns false once installmentsPaid reaches
    // installmentCount — the loan became permanently un-liquidatable.
    for (let i = 0; i < 4; i++) {
      await h.tick();
      await h.program.methods
        .repay(new BN(1))
        .accountsPartial({
          borrower: b.kp.publicKey,
          protocol: h.protocol,
          profile: b.profile,
          loan,
          borrowerTokenAccount: b.ata,
          liquidityVault: h.liquidityVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([b.kp])
        .rpc();
    }

    const l = await h.program.account.loan.fetch(loan);
    assert.equal(l.totalRepaid.toNumber(), 4, "the dust did arrive");
    assert.equal(l.installmentsPaid, 0, "dust completed an installment");
    assert.deepEqual(l.status, { active: {} });

    // And the score was not farmed by it either.
    const profile = await h.program.account.creditProfile.fetch(b.profile);
    assert.equal(profile.onTimePayments, 0, "dust farmed the credit score");
    assert.equal(profile.score, 600);

    // The loan is still liquidatable, which is the whole point.
    await h.warpBy(interval + DAY + 1);
    await liquidate(h, loan, b.kp.publicKey, b.ata).rpc();
    assert.deepEqual((await h.program.account.loan.fetch(loan)).status, { liquidated: {} });
  });

  it("self-liquidation does not write the debt off for free", async () => {
    const h = await setup({ gracePeriod: DAY });
    await h.fundLiquidity(10_000 * USDC);
    const m = await h.newMerchant();

    const principal = 200 * USDC;
    const interval = 7 * DAY;
    const interest = interestFor(principal, 4 * interval);
    const totalOwed = principal + interest;

    const b = await h.newBorrower(1_000 * USDC, totalOwed);
    const { loan } = await createLoan(h, b, m, principal, 4, interval);

    const vaultBefore = (await h.readToken(h.liquidityVault)).amount;
    const borrowerBefore = (await h.readToken(b.ata)).amount;

    await h.warpBy(interval + DAY + 1);

    // The defaulter calls it on themselves, which is exactly the loop that used
    // to be profitable: debt written off, credit line released, borrow again
    // against the score floor, repeat.
    await h.program.methods
      .liquidate()
      .accountsPartial({
        keeper: b.kp.publicKey,
        protocol: h.protocol,
        profile: b.profile,
        loan,
        borrowerTokenAccount: b.ata,
        collateralVault: h.collateralVault,
        liquidityVault: h.liquidityVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([b.kp])
      .rpc();

    // The borrower had the money, so the protocol took it.
    assert.equal((await h.readToken(b.ata)).amount, borrowerBefore - totalOwed);
    assert.equal((await h.readToken(h.liquidityVault)).amount, vaultBefore + totalOwed);

    const p = await h.program.account.protocol.fetch(h.protocol);
    assert.equal(p.badDebt.toNumber(), 0, "booked bad debt it actually recovered");

    // And it cost them their score, not nothing.
    const profile = await h.program.account.creditProfile.fetch(b.profile);
    assert.equal(profile.score, 600 - 150);
    assert.equal(profile.liquidations, 1);
    assert.equal(profile.activeDebt.toNumber(), 0);
  });

  it("books the real shortfall as bad debt when there is nothing to take", async () => {
    const h = await setup({ gracePeriod: DAY });
    await h.fundLiquidity(10_000 * USDC);
    const m = await h.newMerchant();

    const principal = 200 * USDC;
    const interval = 7 * DAY;
    const interest = interestFor(principal, 4 * interval);
    const totalOwed = principal + interest;

    const b = await h.newBorrower(1_000 * USDC, totalOwed);
    const { loan } = await createLoan(h, b, m, principal, 4, interval);

    // The borrower revokes the delegation and moves the money out.
    await h.revoke(b.kp, b.ata);
    assert.equal((await h.readToken(b.ata)).delegate, null);

    await h.warpBy(interval + DAY + 1);
    await liquidate(h, loan, b.kp.publicKey, b.ata).rpc();

    // Nothing recovered, and the protocol says so on chain rather than leaving
    // a silent hole in the pool.
    const p = await h.program.account.protocol.fetch(h.protocol);
    assert.equal(p.badDebt.toNumber(), totalOwed);
    assert.deepEqual((await h.program.account.loan.fetch(loan)).status, { liquidated: {} });
  });

  it("takes its fee out of interest, never out of principal", async () => {
    // The regression: 10% of every repayment treated as interest, 20% of that
    // taken as fee — roughly 2% of the whole loan. On any plan shorter than
    // about 75 days that exceeded every penny of interest earned, and the
    // difference came out of merchant-payout liquidity.
    for (const days of [7, 30, 40]) {
      const h = await setup({ gracePeriod: DAY });
      await h.fundLiquidity(10_000 * USDC);
      const m = await h.newMerchant();

      const principal = 200 * USDC;
      const interval = Math.floor((days * DAY) / 4);
      const interest = interestFor(principal, 4 * interval);
      const totalOwed = principal + interest;

      const b = await h.newBorrower(1_000 * USDC, totalOwed);
      const { loan } = await createLoan(h, b, m, principal, 4, interval);

      for (let k = 0; k < 4; k++) {
        await h.warpBy(interval);
        await collect(h, loan, b.kp.publicKey, b.ata).rpc();
      }

      const p = await h.program.account.protocol.fetch(h.protocol);
      const cap = Math.floor((interest * 2000) / 10_000);
      assert.isAtMost(
        p.protocolFeesAccrued.toNumber(),
        cap,
        `${days}-day plan: fee exceeded 20% of the interest actually earned`,
      );
      // And the pool is whole: principal back, plus interest.
      assert.equal((await h.readToken(h.liquidityVault)).amount, 10_000 * USDC + interest);
    }
  });

  it("one delegation cannot back more loans than it covers", async () => {
    const h = await setup();
    await h.fundLiquidity(10_000 * USDC);
    const m = await h.newMerchant();

    const principal = 100 * USDC;
    const interval = 7 * DAY;
    const interest = interestFor(principal, 4 * interval);
    const totalOwed = principal + interest;

    // Delegated for exactly one plan.
    const b = await h.newBorrower(1_000 * USDC, totalOwed);
    await createLoan(h, b, m, principal, 4, interval);

    // The second one must be refused. Checking only the new loan's total — the
    // bug — let a delegation sized for one plan support as many as the credit
    // limit allowed; settling the first exhausted it, every later collection
    // failed, and the whole balance landed in bad debt while the borrower still
    // held the money.
    await expectError(
      createLoan(h, b, m, principal, 4, interval),
      "InsufficientDelegation",
    );

    // Raising the delegation to cover both is the fix, and it works.
    await h.delegate(b.kp, b.ata, totalOwed * 2 + 10);
    await createLoan(h, b, m, principal, 4, interval);
  });

  it("will not originate against a delegation that is not ours", async () => {
    const h = await setup();
    await h.fundLiquidity(10_000 * USDC);
    const m = await h.newMerchant();
    const b = await h.newBorrower(1_000 * USDC, 0); // no delegation at all
    await expectError(createLoan(h, b, m, 100 * USDC, 4, 7 * DAY), "NotDelegated");
  });
});

describe("the tightenings over the EVM original", () => {
  it("the permissionless path cannot pull more than the installment due", async () => {
    // On EVM, repay(loanId, amount) was permissionless AND took an arbitrary
    // amount, so anyone could drain a borrower's entire standing allowance
    // early. Here the permissionless instruction takes no amount at all.
    const h = await setup();
    await h.fundLiquidity(10_000 * USDC);
    const m = await h.newMerchant();

    const principal = 400 * USDC;
    const interval = 7 * DAY;
    const interest = interestFor(principal, 4 * interval);
    const totalOwed = principal + interest;

    const b = await h.newBorrower(1_000 * USDC, totalOwed);
    const { loan } = await createLoan(h, b, m, principal, 4, interval);

    const before = (await h.readToken(b.ata)).amount;
    await h.warpBy(interval);

    // A hostile third party runs the keeper instruction.
    const attacker = await h.wallet();
    await h.program.methods
      .collectInstallment()
      .accountsPartial({
        keeper: attacker.publicKey,
        protocol: h.protocol,
        profile: b.profile,
        loan,
        borrowerTokenAccount: b.ata,
        liquidityVault: h.liquidityVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([attacker])
      .rpc();

    const taken = before - (await h.readToken(b.ata)).amount;
    assert.equal(taken, thresholdFor(totalOwed, 4, 1), "took more than one installment");

    // And it cannot be run again in the same period.
    await expectError(collect(h, loan, b.kp.publicKey, b.ata).rpc(), "NotDue");
  });

  it("arbitrary-amount repayment needs the borrower's own signature", async () => {
    const h = await setup();
    await h.fundLiquidity(10_000 * USDC);
    const m = await h.newMerchant();
    const b = await h.newBorrower(1_000 * USDC, 500 * USDC);
    const { loan } = await createLoan(h, b, m, 200 * USDC, 4, 7 * DAY);

    const attacker = await h.wallet();
    await expectError(
      h.program.methods
        .repay(new BN(200 * USDC))
        .accountsPartial({
          borrower: attacker.publicKey,
          protocol: h.protocol,
          profile: h.profileOf(attacker.publicKey),
          loan,
          borrowerTokenAccount: b.ata,
          liquidityVault: h.liquidityVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc(),
      "Error",
    );

    // The borrower can pay it off early, in one go.
    await h.program.methods
      .repay(new BN(1_000 * USDC))
      .accountsPartial({
        borrower: b.kp.publicKey,
        protocol: h.protocol,
        profile: b.profile,
        loan,
        borrowerTokenAccount: b.ata,
        liquidityVault: h.liquidityVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([b.kp])
      .rpc();

    const l = await h.program.account.loan.fetch(loan);
    assert.deepEqual(l.status, { repaid: {} }, "early payoff did not close the loan");
    assert.equal(l.totalRepaid.toNumber(), l.totalOwed.toNumber(), "over-collected on payoff");
  });

  it("collection cannot be pointed at a different token account", async () => {
    const h = await setup();
    await h.fundLiquidity(10_000 * USDC);
    const m = await h.newMerchant();
    const b = await h.newBorrower(1_000 * USDC, 500 * USDC);
    const { loan } = await createLoan(h, b, m, 200 * USDC, 4, 7 * DAY);

    const victim = await h.newBorrower(1_000 * USDC, 1_000 * USDC);
    await h.warpBy(7 * DAY);

    await expectError(
      collect(h, loan, b.kp.publicKey, victim.ata).rpc(),
      "TokenOwnerMismatch",
    );
  });
});

describe("credit limits, collateral and merchants", () => {
  it("enforces the credit limit the score allows", async () => {
    const h = await setup();
    await h.fundLiquidity(50_000 * USDC);
    const m = await h.newMerchant("Big Merchant", 50_000 * USDC);

    // A fresh profile scores 600, which is the 500 USDC band.
    const b = await h.newBorrower(5_000 * USDC, 5_000 * USDC);
    await expectError(
      createLoan(h, b, m, 600 * USDC, 4, 7 * DAY),
      "ExceedsCreditLimit",
    );
    await createLoan(h, b, m, 400 * USDC, 4, 7 * DAY);
  });

  it("locked collateral raises the limit by the multiplier", async () => {
    const h = await setup();
    await h.fundLiquidity(50_000 * USDC);
    const m = await h.newMerchant("Big Merchant", 50_000 * USDC);
    const b = await h.newBorrower(5_000 * USDC, 5_000 * USDC);

    await h.program.methods
      .lockCollateral(new BN(200 * USDC))
      .accountsPartial({
        user: b.kp.publicKey,
        protocol: h.protocol,
        profile: b.profile,
        from: b.ata,
        collateralVault: h.collateralVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([b.kp])
      .rpc();

    const profile = await h.program.account.creditProfile.fetch(b.profile);
    assert.equal(profile.lockedCollateral.toNumber(), 200 * USDC);

    // 500 base + 200 * 150% = 800. A 600 loan now fits where it did not before.
    await createLoan(h, b, m, 600 * USDC, 4, 7 * DAY);
  });

  it("will not release collateral that is still securing a loan", async () => {
    const h = await setup();
    await h.fundLiquidity(50_000 * USDC);
    const m = await h.newMerchant();
    const b = await h.newBorrower(5_000 * USDC, 5_000 * USDC);

    const lock = () =>
      h.program.methods
        .lockCollateral(new BN(200 * USDC))
        .accountsPartial({
          user: b.kp.publicKey,
          protocol: h.protocol,
          profile: b.profile,
          from: b.ata,
          collateralVault: h.collateralVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([b.kp]);

    const withdraw = (amount: number) =>
      h.program.methods
        .withdrawCollateral(new BN(amount))
        .accountsPartial({
          user: b.kp.publicKey,
          protocol: h.protocol,
          profile: b.profile,
          collateralVault: h.collateralVault,
          to: b.ata,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([b.kp]);

    await lock().rpc();
    await withdraw(50 * USDC).rpc(); // no debt yet, fine

    await createLoan(h, b, m, 100 * USDC, 4, 7 * DAY);
    await expectError(withdraw(10 * USDC).rpc(), "DebtOutstanding");
  });

  it("seizes collateral toward the shortfall on liquidation", async () => {
    const h = await setup({ gracePeriod: DAY });
    await h.fundLiquidity(50_000 * USDC);
    const m = await h.newMerchant();

    const principal = 300 * USDC;
    const interval = 7 * DAY;
    const interest = interestFor(principal, 4 * interval);
    const totalOwed = principal + interest;

    const b = await h.newBorrower(1_000 * USDC, totalOwed);
    await h.program.methods
      .lockCollateral(new BN(250 * USDC))
      .accountsPartial({
        user: b.kp.publicKey,
        protocol: h.protocol,
        profile: b.profile,
        from: b.ata,
        collateralVault: h.collateralVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([b.kp])
      .rpc();

    const { loan } = await createLoan(h, b, m, principal, 4, interval);

    // Delegation revoked, so the only recovery left is the collateral.
    await h.revoke(b.kp, b.ata);
    await h.warpBy(interval + DAY + 1);
    await liquidate(h, loan, b.kp.publicKey, b.ata).rpc();

    const profile = await h.program.account.creditProfile.fetch(b.profile);
    assert.equal(profile.lockedCollateral.toNumber(), 0, "collateral not seized");
    assert.equal(profile.seizedCollateral.toNumber(), 250 * USDC);

    const p = await h.program.account.protocol.fetch(h.protocol);
    assert.equal(p.badDebt.toNumber(), totalOwed - 250 * USDC, "shortfall mis-booked");
  });

  it("an inactive merchant or an oversized order cannot originate", async () => {
    const h = await setup();
    await h.fundLiquidity(50_000 * USDC);
    const b = await h.newBorrower(5_000 * USDC, 5_000 * USDC);

    // Registered but never activated.
    const authority = await h.wallet();
    const payout = await h.tokenAccount(authority.publicKey);
    const merchant = h.merchantOf(authority.publicKey);
    await h.program.methods
      .registerMerchant("Unapproved", "https://example.test/u.json")
      .accountsPartial({
        authority: authority.publicKey,
        protocol: h.protocol,
        merchant,
        payout,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await expectError(
      createLoan(h, b, { merchant, payout }, 100 * USDC, 4, 7 * DAY),
      "MerchantNotEligible",
    );

    // Activated, but the order is above the per-merchant cap.
    const capped = await h.newMerchant("Capped", 50 * USDC);
    await expectError(
      createLoan(h, b, capped, 100 * USDC, 4, 7 * DAY),
      "MerchantNotEligible",
    );
  });
});

describe("pay now", () => {
  it("splits the fee to the treasury and the rest to the merchant", async () => {
    const h = await setup({ feeBps: 50 });
    const m = await h.newMerchant();
    const payer = await h.wallet();
    const ata = await h.tokenAccount(payer.publicKey, 1_000 * USDC);

    const amount = 100 * USDC;
    const fee = Math.floor((amount * 50) / 10_000);

    await h.program.methods
      .pay(new BN(amount), "ORD-1", Array.from(h.orderHash("ORD-1")))
      .accountsPartial({
        payer: payer.publicKey,
        protocol: h.protocol,
        merchant: m.merchant,
        payment: h.paymentOf(m.merchant, "ORD-1"),
        payerTokenAccount: ata,
        merchantPayout: m.payout,
        treasury: h.treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    assert.equal((await h.readToken(m.payout)).amount, amount - fee);
    assert.equal((await h.readToken(h.treasury)).amount, fee);
  });

  it("a retried checkout cannot pay the same order twice", async () => {
    const h = await setup();
    const m = await h.newMerchant();
    const payer = await h.wallet();
    const ata = await h.tokenAccount(payer.publicKey, 1_000 * USDC);

    const pay = () =>
      h.program.methods
        .pay(new BN(25 * USDC), "ORD-DUP", Array.from(h.orderHash("ORD-DUP")))
        .accountsPartial({
          payer: payer.publicKey,
          protocol: h.protocol,
          merchant: m.merchant,
          payment: h.paymentOf(m.merchant, "ORD-DUP"),
          payerTokenAccount: ata,
          merchantPayout: m.payout,
          treasury: h.treasury,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer]);

    await pay().rpc();
    // The address is the guard: the second init hits an account that exists.
    await expectError(pay().rpc(), "already in use");
  });

  it("rejects a digest that does not belong to the order", async () => {
    const h = await setup();
    const m = await h.newMerchant();
    const payer = await h.wallet();
    const ata = await h.tokenAccount(payer.publicKey, 1_000 * USDC);

    await expectError(
      h.program.methods
        .pay(new BN(10 * USDC), "ORD-A", Array.from(h.orderHash("ORD-B")))
        .accountsPartial({
          payer: payer.publicKey,
          protocol: h.protocol,
          merchant: m.merchant,
          payment: h.paymentOf(m.merchant, "ORD-B"),
          payerTokenAccount: ata,
          merchantPayout: m.payout,
          treasury: h.treasury,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc(),
      "OrderHashMismatch",
    );
  });
});

describe("subscriptions", () => {
  async function withPlan(h: Harness, price: number, period: number) {
    const m = await h.newMerchant();
    const p = await h.program.account.protocol.fetch(h.protocol);
    const planId = p.planCount.toNumber();
    const plan = h.planOf(planId);

    await h.program.methods
      .createPlan(new BN(price), new BN(period), "Monthly")
      .accountsPartial({
        authority: m.authority.publicKey,
        protocol: h.protocol,
        merchant: m.merchant,
        plan,
        systemProgram: SystemProgram.programId,
      })
      .signers([m.authority])
      .rpc();

    return { m, plan, planId };
  }

  function subscribe(h: Harness, m: any, plan: PublicKey, sub: Keypair, ata: PublicKey) {
    return h.program.methods
      .subscribe()
      .accountsPartial({
        subscriber: sub.publicKey,
        protocol: h.protocol,
        merchant: m.merchant,
        plan,
        subscription: h.subOf(sub.publicKey, plan),
        subscriberTokenAccount: ata,
        merchantPayout: m.payout,
        treasury: h.treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([sub]);
  }

  function chargeDue(h: Harness, m: any, plan: PublicKey, sub: PublicKey, ata: PublicKey) {
    return h.program.methods
      .chargeDue()
      .accountsPartial({
        keeper: h.payer.publicKey,
        protocol: h.protocol,
        merchant: m.merchant,
        plan,
        subscription: h.subOf(sub, plan),
        subscriberTokenAccount: ata,
        merchantPayout: m.payout,
        treasury: h.treasury,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([h.payer]);
  }

  it("charges period one at signup, then renews on schedule without the subscriber", async () => {
    const h = await setup({ feeBps: 50 });
    const period = 30 * DAY;
    const price = 10 * USDC;
    const { m, plan } = await withPlan(h, price, period);

    const sub = await h.wallet();
    const ata = await h.tokenAccount(sub.publicKey, 1_000 * USDC);
    await h.delegate(sub, ata, price * 12);

    await subscribe(h, m, plan, sub, ata).rpc();

    // A subscription always starts from a proven-good payment.
    let s = await h.program.account.subscription.fetch(h.subOf(sub.publicKey, plan));
    assert.equal(s.periodsCharged, 1);
    const fee = Math.floor((price * 50) / 10_000);
    assert.equal((await h.readToken(m.payout)).amount, price - fee);

    // Three renewals, collected by a keeper the subscriber never talks to.
    for (let i = 2; i <= 4; i++) {
      await h.warpBy(period);
      await chargeDue(h, m, plan, sub.publicKey, ata).rpc();
      s = await h.program.account.subscription.fetch(h.subOf(sub.publicKey, plan));
      assert.equal(s.periodsCharged, i);
    }
    assert.equal((await h.readToken(m.payout)).amount, 4 * (price - fee));
  });

  it("refuses a second live subscription to the same plan", async () => {
    const h = await setup();
    const { m, plan } = await withPlan(h, 10 * USDC, 30 * DAY);
    const sub = await h.wallet();
    const ata = await h.tokenAccount(sub.publicKey, 1_000 * USDC);
    await h.delegate(sub, ata, 100 * USDC);

    await subscribe(h, m, plan, sub, ata).rpc();
    await expectError(subscribe(h, m, plan, sub, ata).rpc(), "AlreadySubscribed");
  });

  it("lets the subscriber cancel unilaterally, and resubscribe later", async () => {
    const h = await setup();
    const period = 30 * DAY;
    const { m, plan } = await withPlan(h, 10 * USDC, period);
    const sub = await h.wallet();
    const ata = await h.tokenAccount(sub.publicKey, 1_000 * USDC);
    await h.delegate(sub, ata, 100 * USDC);

    await subscribe(h, m, plan, sub, ata).rpc();

    // No merchant cooperation required. That is what makes the standing
    // delegation safe to grant in the first place.
    await h.program.methods
      .cancelSubscription()
      .accountsPartial({
        signer: sub.publicKey,
        merchant: m.merchant,
        plan,
        subscription: h.subOf(sub.publicKey, plan),
      })
      .signers([sub])
      .rpc();

    let s = await h.program.account.subscription.fetch(h.subOf(sub.publicKey, plan));
    assert.deepEqual(s.status, { cancelled: {} });

    // A cancelled subscription must not keep collecting.
    await h.warpBy(period);
    await expectError(
      chargeDue(h, m, plan, sub.publicKey, ata).rpc(),
      "SubscriptionNotActive",
    );

    // And the same pair can start again.
    await subscribe(h, m, plan, sub, ata).rpc();
    s = await h.program.account.subscription.fetch(h.subOf(sub.publicKey, plan));
    assert.deepEqual(s.status, { active: {} });
    assert.equal(s.periodsCharged, 1);
  });

  it("skips a missed period instead of stacking a backlog, and lapses after three", async () => {
    const h = await setup();
    const period = 30 * DAY;
    const price = 10 * USDC;
    const { m, plan } = await withPlan(h, price, period);
    const sub = await h.wallet();
    const ata = await h.tokenAccount(sub.publicKey, 1_000 * USDC);
    await h.delegate(sub, ata, price * 12);

    await subscribe(h, m, plan, sub, ata).rpc();
    const paidAtSignup = (await h.readToken(m.payout)).amount;

    for (let i = 1; i <= 3; i++) {
      // Well past the seven-day charge window.
      await h.warpBy(period + WEEK + DAY);
      await chargeDue(h, m, plan, sub.publicKey, ata).rpc();

      const s = await h.program.account.subscription.fetch(h.subOf(sub.publicKey, plan));
      assert.equal(s.missedCharges, i, `miss ${i} not recorded`);
      assert.equal(s.periodsCharged, 1, "a skipped period was charged anyway");
    }

    // A subscriber returning after months owes nothing retroactively.
    assert.equal((await h.readToken(m.payout)).amount, paidAtSignup);

    const s = await h.program.account.subscription.fetch(h.subOf(sub.publicKey, plan));
    assert.deepEqual(s.status, { lapsed: {} }, "did not lapse after three misses");
  });

  it("will not sign up a subscription that can never renew", async () => {
    const h = await setup();
    const { m, plan } = await withPlan(h, 10 * USDC, 30 * DAY);
    const sub = await h.wallet();
    const ata = await h.tokenAccount(sub.publicKey, 1_000 * USDC);
    // Funded, but never delegated: the first charge would work and every
    // renewal would fail. Better to fail loudly at signup.
    await expectError(subscribe(h, m, plan, sub, ata).rpc(), "NotDelegated");
  });
});
