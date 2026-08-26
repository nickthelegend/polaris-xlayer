use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::errors::PolarisError;
use crate::events::{CollateralLocked, CollateralWithdrawn};
use crate::state::{CreditProfile, Protocol};
use crate::token_ops;

#[derive(Accounts)]
pub struct LockCollateral<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + CreditProfile::INIT_SPACE,
        seeds = [PROFILE_SEED, user.key().as_ref()],
        bump,
    )]
    pub profile: Account<'info, CreditProfile>,

    #[account(mut, constraint = from.mint == protocol.stablecoin @ PolarisError::MintMismatch)]
    pub from: Account<'info, TokenAccount>,

    #[account(mut, seeds = [COLLATERAL_SEED], bump = protocol.collateral_bump)]
    pub collateral_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Lock collateral to raise your credit limit.
///
/// Polaris is a credit-score protocol first: a borrower with no collateral
/// still gets a limit from their repayment history. Collateral is the lever for
/// someone who has no history yet, or who wants more than their score allows.
/// At the default 150% multiplier, locking 100 USDC buys 150 USDC of headroom —
/// still undercollateralized overall, which preserves the point of the product.
pub fn lock_handler(ctx: Context<LockCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, PolarisError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;

    ctx.accounts
        .profile
        .seed_if_new(ctx.accounts.user.key(), now, ctx.bumps.profile);

    let received = token_ops::user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.user,
        &ctx.accounts.from,
        &mut ctx.accounts.collateral_vault,
        amount,
    )?;

    let profile = &mut ctx.accounts.profile;
    profile.locked_collateral = profile
        .locked_collateral
        .checked_add(received)
        .ok_or(error!(PolarisError::MathOverflow))?;

    emit!(CollateralLocked {
        user: profile.user,
        amount: received,
        new_total: profile.locked_collateral,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    pub user: Signer<'info>,

    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,

    #[account(
        mut,
        seeds = [PROFILE_SEED, user.key().as_ref()],
        bump = profile.bump,
        has_one = user @ PolarisError::NotAuthorized,
    )]
    pub profile: Account<'info, CreditProfile>,

    #[account(mut, seeds = [COLLATERAL_SEED], bump = protocol.collateral_bump)]
    pub collateral_vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = to.mint == protocol.stablecoin @ PolarisError::MintMismatch)]
    pub to: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Withdraw collateral. Blocked while any debt is outstanding.
///
/// All-or-nothing rather than a partial release: releasing "the unused portion"
/// needs a solvency calculation that is wrong the moment the borrower's score
/// changes, and a borrower who wants their collateral back can repay.
///
/// On EVM this had to ask the LoanEngine for live debt over an interface call,
/// because mirroring the number in the vault is how a vault ends up releasing
/// collateral that is still securing a loan. Here both numbers are fields on
/// the same account, so they cannot drift.
pub fn withdraw_collateral_handler(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, PolarisError::ZeroAmount);
    require!(
        ctx.accounts.profile.locked_collateral >= amount,
        PolarisError::InsufficientCollateral
    );
    require!(
        ctx.accounts.profile.active_debt == 0,
        PolarisError::DebtOutstanding
    );

    ctx.accounts.profile.locked_collateral -= amount;

    let sent = token_ops::protocol_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.protocol,
        &ctx.accounts.collateral_vault,
        &mut ctx.accounts.to,
        amount,
    )?;

    emit!(CollateralWithdrawn {
        user: ctx.accounts.profile.user,
        amount: sent,
        new_total: ctx.accounts.profile.locked_collateral,
    });
    Ok(())
}
