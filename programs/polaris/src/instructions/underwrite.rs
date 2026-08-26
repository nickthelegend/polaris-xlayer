use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::PolarisError;
use crate::events::Underwritten;
use crate::state::{CreditProfile, Protocol};

/// Open a credit line from what the borrower's wallet already shows.
///
/// The account list is the argument for the design. There is no borrower
/// signature here, because underwriting is something done *to* a wallet from
/// public facts, not something a wallet consents to; and there is no way for
/// the underwriter to name a score, because it does not pass one.
#[derive(Accounts)]
pub struct Underwrite<'info> {
    #[account(mut)]
    pub underwriter: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        constraint = protocol.underwriter == underwriter.key() @ PolarisError::NotUnderwriter,
    )]
    pub protocol: Account<'info, Protocol>,

    /// CHECK: the wallet being underwritten. Never signs, and is only ever read
    /// as the key the profile PDA is derived from.
    pub borrower: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = underwriter,
        space = 8 + CreditProfile::INIT_SPACE,
        seeds = [PROFILE_SEED, borrower.key().as_ref()],
        bump,
    )]
    pub profile: Account<'info, CreditProfile>,

    pub system_program: Program<'info, System>,
}

/// `observed_at` is the cluster time the underwriter read the wallet at, not
/// the time it got round to submitting. Evidence has to be fresh: without this
/// an underwriter could take a flattering reading of a wallet, wait for it to
/// empty, and then open a line on the strength of a balance that has gone.
pub fn underwrite_handler(
    ctx: Context<Underwrite>,
    wallet_age_days: u32,
    transaction_count: u32,
    token_accounts: u32,
    stable_balance: u64,
    observed_at: i64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(observed_at <= now, PolarisError::EvidenceFromTheFuture);
    require!(
        now - observed_at <= MAX_EVIDENCE_AGE,
        PolarisError::EvidenceStale
    );

    let profile = &mut ctx.accounts.profile;
    profile.seed_if_new(ctx.accounts.borrower.key(), now, ctx.bumps.profile);

    // A borrower with any record at all has a score they earned. Underwriting
    // is for the first loan only; after that the book's own history is better
    // evidence than anything a wallet's age can suggest.
    require!(profile.is_unproven(), PolarisError::AlreadyUnderwritten);

    let score = CreditProfile::underwrite_from(
        wallet_age_days,
        transaction_count,
        token_accounts,
        stable_balance,
    );

    profile.score = score;
    profile.underwritten_at = now;
    profile.wallet_age_days = wallet_age_days;
    profile.transaction_count = transaction_count;
    profile.token_accounts = token_accounts;
    profile.stable_balance = stable_balance;

    emit!(Underwritten {
        user: profile.user,
        score,
        credit_limit: profile.credit_limit(ctx.accounts.protocol.credit_multiplier_bps),
        wallet_age_days,
        transaction_count,
        token_accounts,
        stable_balance,
        observed_at,
        underwritten_at: now,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct SetUnderwriter<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = authority @ PolarisError::NotAuthorized,
    )]
    pub protocol: Account<'info, Protocol>,
    /// CHECK: the key that will be allowed to attest. Read as a key only.
    pub underwriter: UncheckedAccount<'info>,
}

/// Move the underwriting role without moving the authority.
///
/// Kept separate from `set_config` because rotating a warm service key is a
/// routine operation and should not sit on the same instruction as the levers
/// that change what every open loan costs.
pub fn set_underwriter_handler(ctx: Context<SetUnderwriter>) -> Result<()> {
    ctx.accounts.protocol.underwriter = ctx.accounts.underwriter.key();
    Ok(())
}
