use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::errors::PolarisError;
use crate::events::*;
use crate::math;
use crate::state::{CreditProfile, Loan, LoanStatus, Merchant, Protocol};
use crate::token_ops;

// ---------------------------------------------------------------------------
// Origination
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CreateLoan<'info> {
    /// The borrower signs their own origination.
    ///
    /// On EVM this was `onlyOriginator`: a permissioned backend called
    /// `createLoan(borrower, ...)` against an allowance the borrower had
    /// granted in an earlier transaction. Solana can put the SPL `Approve` and
    /// this instruction in **one atomic transaction**, so the borrower signs
    /// once at checkout and the permissioned-originator role — along with the
    /// window between approving and borrowing — disappears entirely.
    #[account(mut)]
    pub borrower: Signer<'info>,

    /// Who pays rent for the accounts this opens.
    ///
    /// Normally the borrower, and passing the borrower here is the ordinary
    /// case. A sponsored checkout passes the gateway instead, which is what
    /// lets a customer with no SOL at all open a plan: the fee payer already
    /// differs from the token authority on Solana, and rent is the only other
    /// thing standing between a shopper and a wallet that has never held the
    /// native token. Both still sign, so nobody is opening a loan in someone
    /// else's name.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + CreditProfile::INIT_SPACE,
        seeds = [PROFILE_SEED, borrower.key().as_ref()],
        bump,
    )]
    pub profile: Account<'info, CreditProfile>,

    #[account(seeds = [MERCHANT_SEED, merchant.authority.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,

    #[account(
        init,
        payer = payer,
        space = 8 + Loan::INIT_SPACE,
        seeds = [LOAN_SEED, &protocol.loan_count.to_le_bytes()],
        bump,
    )]
    pub loan: Account<'info, Loan>,

    /// The account every installment will be drawn from. Pinned into the loan
    /// so a keeper cannot later point collection at a different one.
    #[account(
        mut,
        constraint = borrower_token_account.owner == borrower.key() @ PolarisError::TokenOwnerMismatch,
        constraint = borrower_token_account.mint == protocol.stablecoin @ PolarisError::MintMismatch,
    )]
    pub borrower_token_account: Account<'info, TokenAccount>,

    #[account(mut, seeds = [LIQUIDITY_SEED], bump = protocol.liquidity_bump)]
    pub liquidity_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = merchant_payout.key() == merchant.payout @ PolarisError::NotAuthorized,
    )]
    pub merchant_payout: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Open a BNPL plan and pay the merchant immediately, in full. That is the
/// product.
pub fn create_handler(
    ctx: Context<CreateLoan>,
    principal: u64,
    installment_count: u32,
    interval_seconds: i64,
) -> Result<()> {
    require!(principal > 0, PolarisError::ZeroAmount);
    require!(
        installment_count > 0 && installment_count <= MAX_INSTALLMENTS,
        PolarisError::InvalidInstallments
    );
    // An unvalidated interval let a caller pass 0, which made the loan
    // interest-free and due in full at origination — liquidatable one grace
    // period later, against a schedule that never existed.
    require!(
        (ctx.accounts.protocol.min_interval_seconds..=MAX_INTERVAL_SECONDS)
            .contains(&interval_seconds),
        PolarisError::InvalidInterval
    );

    let merchant = &ctx.accounts.merchant;
    require!(
        merchant.active && principal <= merchant.max_order_value,
        PolarisError::MerchantNotEligible
    );

    let now = Clock::get()?.unix_timestamp;
    let loan_id = ctx.accounts.protocol.loan_count;

    ctx.accounts
        .profile
        .seed_if_new(ctx.accounts.borrower.key(), now, ctx.bumps.profile);

    let term = (installment_count as i64)
        .checked_mul(interval_seconds)
        .ok_or(error!(PolarisError::MathOverflow))?;
    let interest = math::interest_for(principal, term)?;
    let total_owed = principal
        .checked_add(interest)
        .ok_or(error!(PolarisError::MathOverflow))?;

    let profile = &ctx.accounts.profile;
    let new_debt = profile
        .active_debt
        .checked_add(total_owed)
        .ok_or(error!(PolarisError::MathOverflow))?;
    require!(
        new_debt <= profile.credit_limit(ctx.accounts.protocol.credit_multiplier_bps),
        PolarisError::ExceedsCreditLimit
    );

    // The whole collection model rests on a standing delegation. Paying the
    // merchant without one is a guaranteed total loss: every later collection
    // fails and liquidation has nothing to pull.
    //
    // The comparison is against everything this borrower owes, not just the
    // loan being opened. One delegation backs every open plan at once, so
    // checking only `total_owed` would let a delegation sized for a single plan
    // support as many loans as the credit limit allowed.
    token_ops::assert_delegated(
        &ctx.accounts.borrower_token_account,
        &ctx.accounts.protocol.key(),
        new_debt,
    )?;

    require!(
        ctx.accounts.liquidity_vault.amount >= principal,
        PolarisError::InsufficientLiquidity
    );

    // State before the transfer out.
    let loan = &mut ctx.accounts.loan;
    loan.id = loan_id;
    loan.borrower = ctx.accounts.borrower.key();
    loan.merchant = merchant.key();
    loan.borrower_token_account = ctx.accounts.borrower_token_account.key();
    loan.principal = principal;
    loan.total_owed = total_owed;
    loan.total_repaid = 0;
    loan.installment_count = installment_count;
    loan.installments_paid = 0;
    loan.started_at = now;
    loan.interval_seconds = interval_seconds;
    loan.status = LoanStatus::Active;
    loan.bump = ctx.bumps.loan;

    ctx.accounts.profile.active_debt = new_debt;
    ctx.accounts.protocol.loan_count = loan_id
        .checked_add(1)
        .ok_or(error!(PolarisError::MathOverflow))?;

    let paid = token_ops::protocol_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.protocol,
        &ctx.accounts.liquidity_vault,
        &mut ctx.accounts.merchant_payout,
        principal,
    )?;

    emit!(LoanCreated {
        loan_id,
        borrower: ctx.accounts.borrower.key(),
        merchant: merchant.key(),
        principal: paid,
        total_owed,
        installments: installment_count,
        started_at: now,
        interval_seconds,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/// The shared settlement core for both collection paths.
///
/// Everything that decides money or credit history happens here exactly once,
/// so the keeper path and the borrower path cannot drift apart.
fn apply_repayment(
    protocol: &mut Protocol,
    profile: &mut CreditProfile,
    loan: &mut Loan,
    received: u64,
    now: i64,
) -> Result<()> {
    let on_time =
        now <= math::installment_due_at(loan.started_at, loan.interval_seconds, loan.installments_paid)
            + protocol.grace_period;

    // 0-based index of the installment this payment goes toward, captured
    // before the counter moves. Reading `installments_paid - 1` afterwards
    // underflows when a partial payment completes nothing.
    let target_index = loan.installments_paid;

    loan.total_repaid = loan
        .total_repaid
        .checked_add(received)
        .ok_or(error!(PolarisError::MathOverflow))?;
    profile.active_debt = profile.active_debt.saturating_sub(received);

    // Progress is read off the same canonical ladder the schedule is built
    // from, so a payment that meets its threshold always counts and one that
    // does not never does. Never incremented per call — that is what let dust
    // buy liquidation immunity.
    let earned = math::installments_earned(loan.total_repaid, loan.total_owed, loan.installment_count);
    let completed_one = earned > loan.installments_paid;
    loan.installments_paid = earned;

    let fee = math::fee_on_payment(received, loan.principal, loan.total_owed)?;
    protocol.protocol_fees_accrued = protocol.protocol_fees_accrued.saturating_add(fee);

    emit!(InstallmentPaid {
        loan_id: loan.id,
        borrower: loan.borrower,
        installment_index: target_index,
        amount: received,
        on_time,
        installments_paid: loan.installments_paid,
        outstanding: loan.total_owed.saturating_sub(loan.total_repaid),
    });

    // Score only moves when an installment actually completed. A partial
    // payment is progress, not a payment event, and scoring it would let a
    // borrower farm their score with dust.
    if completed_one {
        let old = profile.score;
        if on_time {
            profile.record_on_time();
        } else {
            profile.record_late();
        }
        emit!(ScoreChanged {
            user: profile.user,
            old_score: old,
            new_score: profile.score,
            reason: if on_time { "on-time payment" } else { "late payment" }.to_string(),
        });
    }

    if loan.total_repaid >= loan.total_owed {
        loan.status = LoanStatus::Repaid;
        emit!(LoanFullyRepaid {
            loan_id: loan.id,
            borrower: loan.borrower,
        });
        emit!(LoanStatusChanged {
            loan_id: loan.id,
            status: LoanStatus::Repaid,
        });
    }
    Ok(())
}

#[derive(Accounts)]
pub struct CollectInstallment<'info> {
    /// Permissionless. The keeper signs only to pay the transaction fee — it
    /// has no authority over the money.
    ///
    /// This is where KeeperHub's gas sponsorship goes: on Solana the fee payer
    /// is simply a different signer from the token authority, so a keeper that
    /// holds no stablecoin and touches no borrower balance still gets the
    /// transaction landed.
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,

    #[account(
        mut,
        seeds = [PROFILE_SEED, loan.borrower.as_ref()],
        bump = profile.bump,
    )]
    pub profile: Account<'info, CreditProfile>,

    #[account(mut, seeds = [LOAN_SEED, &loan.id.to_le_bytes()], bump = loan.bump)]
    pub loan: Account<'info, Loan>,

    #[account(
        mut,
        constraint = borrower_token_account.key() == loan.borrower_token_account
            @ PolarisError::TokenOwnerMismatch,
    )]
    pub borrower_token_account: Account<'info, TokenAccount>,

    #[account(mut, seeds = [LIQUIDITY_SEED], bump = protocol.liquidity_bump)]
    pub liquidity_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Collect exactly the installment that is due. The keeper entry point.
///
/// It takes no amount. The program computes what is owed and pulls precisely
/// that, which is a deliberate tightening over the EVM original: there,
/// `repay(loanId, amount)` was permissionless *and* took an arbitrary amount,
/// so anyone could drain a borrower's entire standing allowance early. Here the
/// permissionless path can only ever collect what the schedule says is due
/// today, and arbitrary amounts require the borrower's own signature.
pub fn collect_handler(ctx: Context<CollectInstallment>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let loan = &ctx.accounts.loan;

    require!(loan.status == LoanStatus::Active, PolarisError::LoanNotActive);
    require!(
        loan.installments_paid < loan.installment_count,
        PolarisError::LoanNotActive
    );
    require!(
        now >= math::installment_due_at(loan.started_at, loan.interval_seconds, loan.installments_paid),
        PolarisError::NotDue
    );

    let due = math::installment_amount(
        loan.total_repaid,
        loan.total_owed,
        loan.installment_count,
        loan.installments_paid,
    );
    require!(due > 0, PolarisError::ZeroAmount);

    token_ops::assert_delegated(
        &ctx.accounts.borrower_token_account,
        &ctx.accounts.protocol.key(),
        due,
    )?;

    let received = token_ops::protocol_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.protocol,
        &ctx.accounts.borrower_token_account,
        &mut ctx.accounts.liquidity_vault,
        due,
    )?;
    require!(received > 0, PolarisError::ZeroAmount);

    apply_repayment(
        &mut ctx.accounts.protocol,
        &mut ctx.accounts.profile,
        &mut ctx.accounts.loan,
        received,
        now,
    )
}

#[derive(Accounts)]
pub struct Repay<'info> {
    /// The borrower's own signature. This path takes an arbitrary amount, so it
    /// is exactly the one that must not be permissionless.
    pub borrower: Signer<'info>,

    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,

    #[account(
        mut,
        seeds = [PROFILE_SEED, borrower.key().as_ref()],
        bump = profile.bump,
    )]
    pub profile: Account<'info, CreditProfile>,

    #[account(
        mut,
        seeds = [LOAN_SEED, &loan.id.to_le_bytes()],
        bump = loan.bump,
        constraint = loan.borrower == borrower.key() @ PolarisError::NotAuthorized,
    )]
    pub loan: Account<'info, Loan>,

    #[account(
        mut,
        constraint = borrower_token_account.owner == borrower.key() @ PolarisError::TokenOwnerMismatch,
        constraint = borrower_token_account.mint == protocol.stablecoin @ PolarisError::MintMismatch,
    )]
    pub borrower_token_account: Account<'info, TokenAccount>,

    #[account(mut, seeds = [LIQUIDITY_SEED], bump = protocol.liquidity_bump)]
    pub liquidity_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Pay any amount toward a loan, including paying it off entirely.
pub fn repay_handler(ctx: Context<Repay>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let loan = &ctx.accounts.loan;

    require!(loan.status == LoanStatus::Active, PolarisError::LoanNotActive);
    require!(amount > 0, PolarisError::ZeroAmount);

    let remaining = loan.total_owed.saturating_sub(loan.total_repaid);
    let amount = amount.min(remaining);
    require!(amount > 0, PolarisError::ZeroAmount);

    let received = token_ops::user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.borrower,
        &ctx.accounts.borrower_token_account,
        &mut ctx.accounts.liquidity_vault,
        amount,
    )?;
    require!(received > 0, PolarisError::ZeroAmount);

    apply_repayment(
        &mut ctx.accounts.protocol,
        &mut ctx.accounts.profile,
        &mut ctx.accounts.loan,
        received,
        now,
    )
}

// ---------------------------------------------------------------------------
// Liquidation
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Liquidate<'info> {
    /// Permissionless, and fee-payer only — same as collection.
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,

    #[account(mut, seeds = [PROFILE_SEED, loan.borrower.as_ref()], bump = profile.bump)]
    pub profile: Account<'info, CreditProfile>,

    #[account(mut, seeds = [LOAN_SEED, &loan.id.to_le_bytes()], bump = loan.bump)]
    pub loan: Account<'info, Loan>,

    #[account(
        mut,
        constraint = borrower_token_account.key() == loan.borrower_token_account
            @ PolarisError::TokenOwnerMismatch,
    )]
    pub borrower_token_account: Account<'info, TokenAccount>,

    #[account(mut, seeds = [COLLATERAL_SEED], bump = protocol.collateral_bump)]
    pub collateral_vault: Account<'info, TokenAccount>,

    #[account(mut, seeds = [LIQUIDITY_SEED], bump = protocol.liquidity_bump)]
    pub liquidity_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// True when the loan's next installment is past due by more than the grace
/// period. A pure function of state, so it is also what an off-chain keeper
/// evaluates before bothering to send anything.
pub fn is_liquidatable(loan: &Loan, grace_period: i64, now: i64) -> bool {
    if loan.status != LoanStatus::Active {
        return false;
    }
    if loan.installments_paid >= loan.installment_count {
        return false;
    }
    now > math::installment_due_at(loan.started_at, loan.interval_seconds, loan.installments_paid)
        + grace_period
}

/// Liquidate a defaulted loan.
///
/// **This is the instruction KeeperHub's `check-and-execute` existed to
/// emulate.** On EVM, `checkLiquidatable` and `liquidate` were two calls, and
/// the gap between them was a real window in which a borrower repaying at the
/// last second could still be liquidated on a stale read — so the condition had
/// to be evaluated inside a single platform call to close it. On Solana the
/// check is a `require!` on the line above the action, in one instruction,
/// against one view of state. There is no window to close.
///
/// Recovery order matters. An earlier Solidity version moved zero tokens: it
/// marked the loan liquidated, freed the credit line and stopped — which made
/// liquidation *profitable* for the defaulter, who could call it on themselves
/// to have the debt written off and their limit released, then borrow again
/// against the score floor. That loop was infinite and cost the pool the full
/// principal every round.
pub fn liquidate_handler(ctx: Context<Liquidate>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let grace = ctx.accounts.protocol.grace_period;

    require!(
        is_liquidatable(&ctx.accounts.loan, grace, now),
        PolarisError::NotLiquidatable
    );

    let outstanding = ctx
        .accounts
        .loan
        .total_owed
        .saturating_sub(ctx.accounts.loan.total_repaid);

    ctx.accounts.loan.status = LoanStatus::Liquidated;
    ctx.accounts.profile.active_debt = ctx
        .accounts
        .profile
        .active_debt
        .saturating_sub(outstanding);

    // 1. Whatever the standing delegation still permits. Capped at the
    //    borrower's balance so a shortfall is a partial recovery rather than a
    //    revert that would leave the loan permanently un-liquidatable.
    let from_delegation = token_ops::recoverable(
        &ctx.accounts.borrower_token_account,
        &ctx.accounts.protocol.key(),
    )
    .min(outstanding);

    let mut recovered = token_ops::protocol_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.protocol,
        &ctx.accounts.borrower_token_account,
        &mut ctx.accounts.liquidity_vault,
        from_delegation,
    )?;

    // 2. Seized collateral, toward whatever is still short.
    if recovered < outstanding {
        let want = outstanding - recovered;
        let take = want.min(ctx.accounts.profile.locked_collateral);
        if take > 0 {
            ctx.accounts.profile.locked_collateral -= take;
            ctx.accounts.profile.seized_collateral = ctx
                .accounts
                .profile
                .seized_collateral
                .saturating_add(take);

            let seized = token_ops::protocol_transfer(
                &ctx.accounts.token_program,
                &ctx.accounts.protocol,
                &ctx.accounts.collateral_vault,
                &mut ctx.accounts.liquidity_vault,
                take,
            )?;
            recovered = recovered.saturating_add(seized);
            emit!(CollateralSeized {
                user: ctx.accounts.profile.user,
                amount: seized,
            });
        }
    }

    ctx.accounts.loan.total_repaid = ctx
        .accounts
        .loan
        .total_repaid
        .saturating_add(recovered);

    // 3. Book the unrecovered remainder, so the protocol has an on-chain
    //    measure of its own losses rather than a silent hole in the pool.
    let shortfall = outstanding.saturating_sub(recovered);
    ctx.accounts.protocol.bad_debt = ctx
        .accounts
        .protocol
        .bad_debt
        .saturating_add(shortfall);

    let old = ctx.accounts.profile.score;
    ctx.accounts.profile.record_liquidation();
    emit!(ScoreChanged {
        user: ctx.accounts.profile.user,
        old_score: old,
        new_score: ctx.accounts.profile.score,
        reason: "liquidation".to_string(),
    });

    emit!(LoanLiquidated {
        loan_id: ctx.accounts.loan.id,
        borrower: ctx.accounts.loan.borrower,
        outstanding,
        recovered,
        bad_debt: shortfall,
    });
    emit!(LoanStatusChanged {
        loan_id: ctx.accounts.loan.id,
        status: LoanStatus::Liquidated,
    });
    Ok(())
}
