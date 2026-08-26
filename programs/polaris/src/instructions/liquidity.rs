use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::errors::PolarisError;
use crate::events::{FeesSwept, LiquidityFunded, LiquidityWithdrawn};
use crate::state::Protocol;
use crate::token_ops;

#[derive(Accounts)]
pub struct FundLiquidity<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, constraint = from.mint == protocol.stablecoin @ PolarisError::MintMismatch)]
    pub from: Account<'info, TokenAccount>,
    #[account(mut, seeds = [LIQUIDITY_SEED], bump = protocol.liquidity_bump)]
    pub liquidity_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Seed the pool that merchants are paid from.
pub fn fund_handler(ctx: Context<FundLiquidity>, amount: u64) -> Result<()> {
    require!(amount > 0, PolarisError::ZeroAmount);
    let received = token_ops::user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.funder,
        &ctx.accounts.from,
        &mut ctx.accounts.liquidity_vault,
        amount,
    )?;
    emit!(LiquidityFunded {
        from: ctx.accounts.funder.key(),
        amount: received,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = authority @ PolarisError::NotAuthorized,
    )]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [LIQUIDITY_SEED], bump = protocol.liquidity_bump)]
    pub liquidity_vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = to.mint == protocol.stablecoin @ PolarisError::MintMismatch)]
    pub to: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Withdraw idle liquidity.
///
/// Accrued fees are excluded from what is withdrawable, so a withdrawal cannot
/// strand the treasury's claim on money the protocol has already earned.
pub fn withdraw_liquidity_handler(ctx: Context<WithdrawLiquidity>, amount: u64) -> Result<()> {
    require!(amount > 0, PolarisError::ZeroAmount);
    let balance = ctx.accounts.liquidity_vault.amount;
    let free = balance.saturating_sub(ctx.accounts.protocol.protocol_fees_accrued);
    require!(amount <= free, PolarisError::InsufficientLiquidity);

    let sent = token_ops::protocol_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.protocol,
        &ctx.accounts.liquidity_vault,
        &mut ctx.accounts.to,
        amount,
    )?;
    emit!(LiquidityWithdrawn {
        to: ctx.accounts.to.key(),
        amount: sent,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SweepFees<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = authority @ PolarisError::NotAuthorized,
        has_one = treasury @ PolarisError::NotAuthorized,
    )]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [LIQUIDITY_SEED], bump = protocol.liquidity_bump)]
    pub liquidity_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn sweep_fees_handler(ctx: Context<SweepFees>) -> Result<()> {
    let amount = ctx.accounts.protocol.protocol_fees_accrued;
    require!(amount > 0, PolarisError::ZeroAmount);
    // Zero the ledger before the transfer, not after.
    ctx.accounts.protocol.protocol_fees_accrued = 0;

    let sent = token_ops::protocol_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.protocol,
        &ctx.accounts.liquidity_vault,
        &mut ctx.accounts.treasury,
        amount,
    )?;
    emit!(FeesSwept {
        to: ctx.accounts.treasury.key(),
        amount: sent,
    });
    Ok(())
}
