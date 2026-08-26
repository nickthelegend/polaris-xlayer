use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::errors::PolarisError;
use crate::events::PaymentMade;
use crate::math;
use crate::state::{Merchant, Payment, Protocol};
use crate::token_ops;

#[derive(Accounts)]
#[instruction(amount: u64, order_ref: [u8; 32])]
pub struct Pay<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,

    #[account(
        mut,
        seeds = [MERCHANT_SEED, merchant.authority.as_ref()],
        bump = merchant.bump,
    )]
    pub merchant: Account<'info, Merchant>,

    /// Seeded by (merchant, order reference).
    ///
    /// On EVM this was `keccak256(merchant, orderId)` used as a mapping key,
    /// with an explicit `if (payments[id].paidAt != 0) revert DuplicatePayment`.
    /// Here the address *is* the guard: a retrying checkout hits an account
    /// that already exists and `init` fails. The check cannot be forgotten,
    /// because it is not a check.
    ///
    /// The reference is the identifier itself rather than a digest of a string
    /// carried alongside it. Nothing to recompute means nothing to disagree.
    #[account(
        init,
        payer = payer,
        space = 8 + Payment::INIT_SPACE,
        seeds = [PAYMENT_SEED, merchant.key().as_ref(), &order_ref],
        bump,
    )]
    pub payment: Account<'info, Payment>,

    #[account(
        mut,
        constraint = payer_token_account.owner == payer.key() @ PolarisError::TokenOwnerMismatch,
        constraint = payer_token_account.mint == protocol.stablecoin @ PolarisError::MintMismatch,
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = merchant_payout.key() == merchant.payout @ PolarisError::NotAuthorized,
    )]
    pub merchant_payout: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury.key() == protocol.treasury @ PolarisError::NotAuthorized,
    )]
    pub treasury: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Pay a merchant in full, now. The mode that is not credit.
pub fn pay_handler(ctx: Context<Pay>, amount: u64, order_ref: [u8; 32]) -> Result<()> {
    require!(amount > 0, PolarisError::ZeroAmount);

    let now = Clock::get()?.unix_timestamp;
    let fee = math::flat_fee(amount, ctx.accounts.protocol.fee_bps)?;
    let net = amount.saturating_sub(fee);

    let to_merchant = token_ops::user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.payer,
        &ctx.accounts.payer_token_account,
        &mut ctx.accounts.merchant_payout,
        net,
    )?;
    let to_treasury = token_ops::user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.payer,
        &ctx.accounts.payer_token_account,
        &mut ctx.accounts.treasury,
        fee,
    )?;

    let p = &mut ctx.accounts.payment;
    p.payer = ctx.accounts.payer.key();
    p.merchant = ctx.accounts.merchant.key();
    p.amount = to_merchant.saturating_add(to_treasury);
    p.fee = to_treasury;
    p.order_ref = order_ref;
    p.paid_at = now;
    p.bump = ctx.bumps.payment;

    let merchant = &mut ctx.accounts.merchant;
    merchant.total_settled = merchant.total_settled.saturating_add(to_merchant);

    ctx.accounts.protocol.payment_count = ctx.accounts.protocol.payment_count.saturating_add(1);

    emit!(PaymentMade {
        payer: p.payer,
        merchant: p.merchant,
        amount: p.amount,
        fee: p.fee,
        order_ref,
    });
    Ok(())
}
