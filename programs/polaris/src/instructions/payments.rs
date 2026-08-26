use anchor_lang::prelude::*;
use solana_sha256_hasher::hash;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::errors::PolarisError;
use crate::events::PaymentMade;
use crate::math;
use crate::state::{Merchant, Payment, Protocol};
use crate::token_ops;

#[derive(Accounts)]
#[instruction(amount: u64, order_id: String, order_hash: [u8; 32])]
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

    /// Seeded by (merchant, sha256(order id)).
    ///
    /// On EVM this was `keccak256(merchant, orderId)` used as a mapping key,
    /// with an explicit `if (payments[id].paidAt != 0) revert DuplicatePayment`.
    /// Here the address *is* the guard: a retrying checkout hits an account
    /// that already exists and `init` fails. The check cannot be forgotten
    /// because it is not a check.
    ///
    /// The digest arrives as an argument rather than being computed inside the
    /// seed expression, because Anchor's IDL builder can only represent seeds
    /// built from plain accounts, constants and arguments — a function call
    /// there compiles for SBF but cannot be described to a client. The handler
    /// recomputes it from `order_id` and rejects a mismatch, so passing a
    /// digest that does not belong to the order is not a way in.
    #[account(
        init,
        payer = payer,
        space = 8 + Payment::INIT_SPACE,
        seeds = [PAYMENT_SEED, merchant.key().as_ref(), &order_hash],
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
pub fn pay_handler(
    ctx: Context<Pay>,
    amount: u64,
    order_id: String,
    order_hash: [u8; 32],
) -> Result<()> {
    require!(amount > 0, PolarisError::ZeroAmount);
    require!(
        order_id.len() <= MAX_ORDER_ID_LEN,
        PolarisError::StringTooLong
    );
    // The digest is what addresses the account, so it has to be the digest of
    // the order this payment claims to settle. Without this a payer could
    // occupy an unrelated address and the merchant's "has order X been paid?"
    // lookup would miss a payment that really happened.
    require!(
        hash(order_id.as_bytes()).to_bytes() == order_hash,
        PolarisError::OrderHashMismatch
    );

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
        order_id,
    });
    Ok(())
}
