use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::PolarisError;
use crate::state::Protocol;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Protocol::INIT_SPACE,
        seeds = [PROTOCOL_SEED],
        bump,
    )]
    pub protocol: Account<'info, Protocol>,

    pub stablecoin: Account<'info, Mint>,

    /// Where protocol fees are swept. Must hold the protocol stablecoin.
    #[account(constraint = treasury.mint == stablecoin.key() @ PolarisError::MintMismatch)]
    pub treasury: Account<'info, TokenAccount>,

    /// The pool merchants are paid from and repayments land in.
    #[account(
        init,
        payer = authority,
        seeds = [LIQUIDITY_SEED],
        bump,
        token::mint = stablecoin,
        token::authority = protocol,
    )]
    pub liquidity_vault: Account<'info, TokenAccount>,

    /// Locked borrower collateral. Held apart from lending liquidity so a
    /// withdrawal of idle capital can never reach into it.
    #[account(
        init,
        payer = authority,
        seeds = [COLLATERAL_SEED],
        bump,
        token::mint = stablecoin,
        token::authority = protocol,
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Stand the protocol up.
///
/// `grace_period` is set once here rather than being a global constant: a
/// consumer book wants days, a machine-to-machine book wants minutes, and a
/// devnet deployment wants seconds so the liquidation path can be demonstrated
/// without waiting three days. Zero means the default.
pub fn handler(
    ctx: Context<Initialize>,
    grace_period: i64,
    fee_bps: u16,
    credit_multiplier_bps: u16,
) -> Result<()> {
    require!(grace_period >= 0, PolarisError::InvalidGracePeriod);
    require!(grace_period <= MAX_GRACE_PERIOD, PolarisError::InvalidGracePeriod);
    require!(fee_bps <= MAX_FEE_BPS, PolarisError::InvalidFee);
    require!(
        credit_multiplier_bps > 0 && credit_multiplier_bps <= MAX_CREDIT_MULTIPLIER_BPS,
        PolarisError::InvalidMultiplier
    );

    let p = &mut ctx.accounts.protocol;
    p.authority = ctx.accounts.authority.key();
    p.stablecoin = ctx.accounts.stablecoin.key();
    p.treasury = ctx.accounts.treasury.key();
    p.grace_period = if grace_period == 0 {
        DEFAULT_GRACE_PERIOD
    } else {
        grace_period
    };
    p.loan_count = 0;
    p.plan_count = 0;
    p.payment_count = 0;
    p.subscription_count = 0;
    p.protocol_fees_accrued = 0;
    p.bad_debt = 0;
    p.fee_bps = fee_bps;
    p.credit_multiplier_bps = credit_multiplier_bps;
    p.bump = ctx.bumps.protocol;
    p.liquidity_bump = ctx.bumps.liquidity_vault;
    p.collateral_bump = ctx.bumps.collateral_vault;

    Ok(())
}

#[derive(Accounts)]
pub struct SetConfig<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = authority @ PolarisError::NotAuthorized,
    )]
    pub protocol: Account<'info, Protocol>,
    #[account(constraint = treasury.mint == protocol.stablecoin @ PolarisError::MintMismatch)]
    pub treasury: Account<'info, TokenAccount>,
}

/// Adjust the levers that are safe to move under a live book.
///
/// `grace_period` is deliberately absent: it is fixed at initialization so it
/// can never be changed under a loan that is already running its schedule.
pub fn set_config_handler(
    ctx: Context<SetConfig>,
    fee_bps: u16,
    credit_multiplier_bps: u16,
) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, PolarisError::InvalidFee);
    require!(
        credit_multiplier_bps > 0 && credit_multiplier_bps <= MAX_CREDIT_MULTIPLIER_BPS,
        PolarisError::InvalidMultiplier
    );
    let p = &mut ctx.accounts.protocol;
    p.fee_bps = fee_bps;
    p.credit_multiplier_bps = credit_multiplier_bps;
    p.treasury = ctx.accounts.treasury.key();
    Ok(())
}
