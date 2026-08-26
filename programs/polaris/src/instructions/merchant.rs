use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::constants::*;
use crate::errors::PolarisError;
use crate::events::{MerchantActivated, MerchantRegistered};
use crate::state::{Merchant, Protocol};

#[derive(Accounts)]
pub struct RegisterMerchant<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,

    #[account(
        init,
        payer = authority,
        space = 8 + Merchant::INIT_SPACE,
        seeds = [MERCHANT_SEED, authority.key().as_ref()],
        bump,
    )]
    pub merchant: Account<'info, Merchant>,

    /// Where this merchant is settled. Must hold the protocol stablecoin.
    #[account(constraint = payout.mint == protocol.stablecoin @ PolarisError::MintMismatch)]
    pub payout: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

/// Merchants self-register and are activated by the protocol.
///
/// Registration alone originates nothing: `active` starts false and the cap
/// starts conservative, so a fresh registration cannot draw against the pool.
pub fn register_handler(
    ctx: Context<RegisterMerchant>,
    name: String,
    metadata_uri: String,
) -> Result<()> {
    require!(name.len() <= MAX_NAME_LEN, PolarisError::StringTooLong);
    require!(metadata_uri.len() <= MAX_URI_LEN, PolarisError::StringTooLong);

    let now = Clock::get()?.unix_timestamp;
    let m = &mut ctx.accounts.merchant;
    m.authority = ctx.accounts.authority.key();
    m.payout = ctx.accounts.payout.key();
    m.name = name.clone();
    m.metadata_uri = metadata_uri;
    m.max_order_value = DEFAULT_MAX_ORDER_VALUE;
    m.total_settled = 0;
    m.registered_at = now;
    m.active = false;
    m.bump = ctx.bumps.merchant;

    emit!(MerchantRegistered {
        merchant: m.key(),
        authority: m.authority,
        name,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct AdminMerchant<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = authority @ PolarisError::NotAuthorized,
    )]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [MERCHANT_SEED, merchant.authority.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
}

pub fn set_active_handler(ctx: Context<AdminMerchant>, active: bool) -> Result<()> {
    let m = &mut ctx.accounts.merchant;
    m.active = active;
    emit!(MerchantActivated {
        merchant: m.key(),
        active,
    });
    Ok(())
}

/// Per-merchant caps exist because BNPL exposure is a function of who is
/// selling as much as who is buying. A merchant with a high refund or dispute
/// rate should be able to originate less, and that lever has to live on chain
/// where origination can see it.
pub fn set_max_order_handler(ctx: Context<AdminMerchant>, max_order_value: u64) -> Result<()> {
    ctx.accounts.merchant.max_order_value = max_order_value;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdatePayout<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(
        mut,
        seeds = [MERCHANT_SEED, authority.key().as_ref()],
        bump = merchant.bump,
        has_one = authority @ PolarisError::NotAuthorized,
    )]
    pub merchant: Account<'info, Merchant>,
    #[account(constraint = payout.mint == protocol.stablecoin @ PolarisError::MintMismatch)]
    pub payout: Account<'info, TokenAccount>,
}

pub fn update_payout_handler(ctx: Context<UpdatePayout>) -> Result<()> {
    ctx.accounts.merchant.payout = ctx.accounts.payout.key();
    Ok(())
}
