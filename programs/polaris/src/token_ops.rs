//! Token movement, in one place.
//!
//! Two things every transfer in this program does, and why:
//!
//! **Balance-delta measurement.** What is credited is what the destination
//! actually received, never what was asked for. Classic SPL USDC has no
//! transfer fee, but Token-2022 does, and a fee-bearing mint would otherwise
//! over-credit a borrower for money the protocol never got. One extra account
//! reload is cheap insurance.
//!
//! **Typed delegation checks.** SPL enforces the delegation itself and would
//! fail the CPI anyway, but it fails with a generic token error. The dunning
//! ladder has to tell "the borrower revoked us" from "the delegation ran dry" —
//! the first is terminal, the second may self-cure — so both are checked here
//! and returned as distinct errors before the CPI is attempted.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::PROTOCOL_SEED;
use crate::errors::PolarisError;
use crate::state::Protocol;

/// Confirm a token account is delegated to the protocol for at least `required`.
///
/// This is the Solana analogue of the Solidity
/// `allowance(borrower, address(this)) < required` guard, and it carries the
/// same lesson: the comparison must be against everything the borrower owes,
/// not just the loan being opened. One delegation backs every open plan at
/// once. Sizing it for a single plan let one approval support as many loans as
/// the credit limit allowed, and the pool ate the difference.
pub fn assert_delegated(
    account: &TokenAccount,
    protocol_key: &Pubkey,
    required: u64,
) -> Result<()> {
    match account.delegate {
        anchor_lang::solana_program::program_option::COption::Some(d) if d == *protocol_key => {}
        _ => return Err(error!(PolarisError::NotDelegated)),
    }
    require!(
        account.delegated_amount >= required,
        PolarisError::InsufficientDelegation
    );
    Ok(())
}

/// What this account could actually deliver right now: the smaller of its
/// balance and what is still delegated. Zero if the delegate was revoked.
///
/// Liquidation uses this rather than reverting, so a shortfall is a partial
/// recovery instead of a failure that leaves the loan un-liquidatable.
pub fn recoverable(account: &TokenAccount, protocol_key: &Pubkey) -> u64 {
    let delegated = match account.delegate {
        anchor_lang::solana_program::program_option::COption::Some(d) if d == *protocol_key => {
            account.delegated_amount
        }
        _ => 0,
    };
    delegated.min(account.amount)
}

pub fn assert_mint(account: &TokenAccount, mint: &Pubkey) -> Result<()> {
    require_keys_eq!(account.mint, *mint, PolarisError::MintMismatch);
    Ok(())
}

pub fn assert_owner(account: &TokenAccount, owner: &Pubkey) -> Result<()> {
    require_keys_eq!(account.owner, *owner, PolarisError::TokenOwnerMismatch);
    Ok(())
}

/// Move tokens with the protocol PDA as authority.
///
/// Covers both cases that need it: pulling from a borrower's delegated account,
/// and paying out of a protocol-owned vault. They are the same CPI with a
/// different `from`, because the protocol PDA is the delegate in one and the
/// account owner in the other.
///
/// Returns what the destination actually received.
pub fn protocol_transfer<'info>(
    token_program: &Program<'info, Token>,
    protocol: &Account<'info, Protocol>,
    from: &Account<'info, TokenAccount>,
    to: &mut Account<'info, TokenAccount>,
    amount: u64,
) -> Result<u64> {
    if amount == 0 {
        return Ok(0);
    }
    let before = to.amount;
    let bump = [protocol.bump];
    let seeds: &[&[u8]] = &[PROTOCOL_SEED, &bump];

    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: from.to_account_info(),
                to: to.to_account_info(),
                authority: protocol.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    to.reload()?;
    Ok(to.amount.saturating_sub(before))
}

/// Move tokens with the wallet holder as authority, for the paths where the
/// payer is online and signing anyway.
///
/// Returns what the destination actually received.
pub fn user_transfer<'info>(
    token_program: &Program<'info, Token>,
    authority: &Signer<'info>,
    from: &Account<'info, TokenAccount>,
    to: &mut Account<'info, TokenAccount>,
    amount: u64,
) -> Result<u64> {
    if amount == 0 {
        return Ok(0);
    }
    let before = to.amount;

    token::transfer(
        CpiContext::new(
            token_program.to_account_info(),
            Transfer {
                from: from.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
    )?;

    to.reload()?;
    Ok(to.amount.saturating_sub(before))
}
