use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::errors::PolarisError;
use crate::events::*;
use crate::math;
use crate::state::{Merchant, Plan, Protocol, SubStatus, Subscription};
use crate::token_ops;

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CreatePlan<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,

    #[account(
        seeds = [MERCHANT_SEED, authority.key().as_ref()],
        bump = merchant.bump,
        has_one = authority @ PolarisError::NotAuthorized,
    )]
    pub merchant: Account<'info, Merchant>,

    #[account(
        init,
        payer = authority,
        space = 8 + Plan::INIT_SPACE,
        seeds = [PLAN_SEED, &protocol.plan_count.to_le_bytes()],
        bump,
    )]
    pub plan: Account<'info, Plan>,

    pub system_program: Program<'info, System>,
}

pub fn create_plan_handler(
    ctx: Context<CreatePlan>,
    price_per_period: u64,
    period_seconds: i64,
    name: String,
) -> Result<()> {
    require!(price_per_period > 0, PolarisError::ZeroAmount);
    require!(name.len() <= MAX_NAME_LEN, PolarisError::StringTooLong);
    // A period under an hour is almost certainly a mistake, and one over a year
    // makes the delegation a standing risk for no benefit.
    require!(
        (MIN_INTERVAL_SECONDS..=MAX_INTERVAL_SECONDS).contains(&period_seconds),
        PolarisError::InvalidPeriod
    );

    let plan_id = ctx.accounts.protocol.plan_count;
    let plan = &mut ctx.accounts.plan;
    plan.id = plan_id;
    plan.merchant = ctx.accounts.merchant.key();
    plan.price_per_period = price_per_period;
    plan.period_seconds = period_seconds;
    plan.active = true;
    plan.name = name;
    plan.bump = ctx.bumps.plan;

    ctx.accounts.protocol.plan_count = plan_id.saturating_add(1);

    emit!(PlanCreated {
        plan_id,
        merchant: plan.merchant,
        price_per_period,
        period_seconds,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct DeactivatePlan<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [MERCHANT_SEED, authority.key().as_ref()],
        bump = merchant.bump,
        has_one = authority @ PolarisError::NotAuthorized,
    )]
    pub merchant: Account<'info, Merchant>,
    #[account(
        mut,
        seeds = [PLAN_SEED, &plan.id.to_le_bytes()],
        bump = plan.bump,
        constraint = plan.merchant == merchant.key() @ PolarisError::NotAuthorized,
    )]
    pub plan: Account<'info, Plan>,
}

pub fn deactivate_plan_handler(ctx: Context<DeactivatePlan>) -> Result<()> {
    ctx.accounts.plan.active = false;
    Ok(())
}

// ---------------------------------------------------------------------------
// Subscribing
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Subscribe<'info> {
    #[account(mut)]
    pub subscriber: Signer<'info>,

    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,

    #[account(mut, seeds = [MERCHANT_SEED, merchant.authority.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,

    #[account(
        seeds = [PLAN_SEED, &plan.id.to_le_bytes()],
        bump = plan.bump,
        constraint = plan.merchant == merchant.key() @ PolarisError::NotAuthorized,
    )]
    pub plan: Account<'info, Plan>,

    /// Seeded by (subscriber, plan). One live subscription per pair is a
    /// property of the address, so a double-subscribe is impossible rather than
    /// merely checked for. `init_if_needed` is what lets a cancelled
    /// subscription be restarted in the same slot; the status guard below is
    /// what stops it being restarted while still active.
    #[account(
        init_if_needed,
        payer = subscriber,
        space = 8 + Subscription::INIT_SPACE,
        seeds = [SUB_SEED, subscriber.key().as_ref(), plan.key().as_ref()],
        bump,
    )]
    pub subscription: Account<'info, Subscription>,

    #[account(
        mut,
        constraint = subscriber_token_account.owner == subscriber.key() @ PolarisError::TokenOwnerMismatch,
        constraint = subscriber_token_account.mint == protocol.stablecoin @ PolarisError::MintMismatch,
    )]
    pub subscriber_token_account: Account<'info, TokenAccount>,

    #[account(mut, constraint = merchant_payout.key() == merchant.payout @ PolarisError::NotAuthorized)]
    pub merchant_payout: Account<'info, TokenAccount>,

    #[account(mut, constraint = treasury.key() == protocol.treasury @ PolarisError::NotAuthorized)]
    pub treasury: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Subscribe and pay the first period immediately.
///
/// Charging period one at subscribe time means a subscription always starts
/// from a proven-good payment, so a plan can never sit "active" having never
/// collected anything.
///
/// The first charge is signed by the subscriber directly, so it does not touch
/// the delegation — but a delegation covering at least one future period is
/// still required here, because a subscription that cannot be charged again is
/// dead on arrival and should fail loudly at signup rather than silently at the
/// first renewal.
pub fn subscribe_handler(ctx: Context<Subscribe>) -> Result<()> {
    let plan = &ctx.accounts.plan;
    require!(plan.active, PolarisError::PlanNotActive);

    let sub = &ctx.accounts.subscription;
    // A zero `started_at` means the account was just created by
    // `init_if_needed`; anything else is a prior subscription being restarted.
    require!(
        sub.started_at == 0 || sub.status != SubStatus::Active,
        PolarisError::AlreadySubscribed
    );

    token_ops::assert_delegated(
        &ctx.accounts.subscriber_token_account,
        &ctx.accounts.protocol.key(),
        plan.price_per_period,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let price = plan.price_per_period;
    let fee = math::flat_fee(price, ctx.accounts.protocol.fee_bps)?;
    let net = price.saturating_sub(fee);

    let to_merchant = token_ops::user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.subscriber,
        &ctx.accounts.subscriber_token_account,
        &mut ctx.accounts.merchant_payout,
        net,
    )?;
    let to_treasury = token_ops::user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.subscriber,
        &ctx.accounts.subscriber_token_account,
        &mut ctx.accounts.treasury,
        fee,
    )?;

    let plan_key = ctx.accounts.plan.key();
    let plan_id = ctx.accounts.plan.id;
    let period = ctx.accounts.plan.period_seconds;

    let sub = &mut ctx.accounts.subscription;
    sub.subscriber = ctx.accounts.subscriber.key();
    sub.plan = plan_key;
    sub.subscriber_token_account = ctx.accounts.subscriber_token_account.key();
    sub.started_at = now;
    sub.next_charge_at = now + period;
    sub.periods_charged = 1;
    sub.missed_charges = 0;
    sub.status = SubStatus::Active;
    sub.bump = ctx.bumps.subscription;

    let merchant = &mut ctx.accounts.merchant;
    merchant.total_settled = merchant.total_settled.saturating_add(to_merchant);

    ctx.accounts.protocol.subscription_count =
        ctx.accounts.protocol.subscription_count.saturating_add(1);

    emit!(Subscribed {
        plan_id,
        subscriber: sub.subscriber,
    });
    emit!(SubscriptionCharged {
        plan_id,
        subscriber: sub.subscriber,
        amount: to_merchant.saturating_add(to_treasury),
        fee: to_treasury,
        period: 1,
        next_charge_at: sub.next_charge_at,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Charging
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ChargeDue<'info> {
    /// Permissionless, and fee-payer only.
    ///
    /// Funds can only travel subscriber → merchant on a schedule the subscriber
    /// already agreed to, so a third-party keeper calling this is harmless and
    /// keeps collection decentralised.
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,

    #[account(mut, seeds = [MERCHANT_SEED, merchant.authority.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,

    #[account(
        seeds = [PLAN_SEED, &plan.id.to_le_bytes()],
        bump = plan.bump,
        constraint = plan.merchant == merchant.key() @ PolarisError::NotAuthorized,
    )]
    pub plan: Account<'info, Plan>,

    #[account(
        mut,
        seeds = [SUB_SEED, subscription.subscriber.as_ref(), plan.key().as_ref()],
        bump = subscription.bump,
    )]
    pub subscription: Account<'info, Subscription>,

    #[account(
        mut,
        constraint = subscriber_token_account.key() == subscription.subscriber_token_account
            @ PolarisError::TokenOwnerMismatch,
    )]
    pub subscriber_token_account: Account<'info, TokenAccount>,

    #[account(mut, constraint = merchant_payout.key() == merchant.payout @ PolarisError::NotAuthorized)]
    pub merchant_payout: Account<'info, TokenAccount>,

    #[account(mut, constraint = treasury.key() == protocol.treasury @ PolarisError::NotAuthorized)]
    pub treasury: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Collect one period. The subscription analogue of `collect_installment`.
pub fn charge_due_handler(ctx: Context<ChargeDue>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    require!(
        ctx.accounts.subscription.status == SubStatus::Active,
        PolarisError::SubscriptionNotActive
    );
    require!(
        now >= ctx.accounts.subscription.next_charge_at,
        PolarisError::NotDue
    );

    let plan_id = ctx.accounts.plan.id;
    let period = ctx.accounts.plan.period_seconds;
    let price = ctx.accounts.plan.price_per_period;

    // Past the window the period is skipped, not stacked. Advancing to the next
    // boundary rather than adding one period stops a long-absent subscriber
    // from owing a backlog of charges they never consumed.
    if now > ctx.accounts.subscription.next_charge_at + CHARGE_WINDOW {
        let sub = &mut ctx.accounts.subscription;
        sub.missed_charges = sub.missed_charges.saturating_add(1);
        let elapsed = now - sub.next_charge_at;
        let periods = elapsed / period + 1;
        sub.next_charge_at += periods * period;

        emit!(ChargeMissed {
            plan_id,
            subscriber: sub.subscriber,
            misses: sub.missed_charges,
            next_charge_at: sub.next_charge_at,
            reason: "charge window elapsed".to_string(),
        });

        if sub.missed_charges >= MAX_MISSES {
            sub.status = SubStatus::Lapsed;
            emit!(SubscriptionLapsed {
                plan_id,
                subscriber: sub.subscriber,
                misses: sub.missed_charges,
            });
        }
        return Ok(());
    }

    require!(ctx.accounts.plan.active, PolarisError::PlanNotActive);

    token_ops::assert_delegated(
        &ctx.accounts.subscriber_token_account,
        &ctx.accounts.protocol.key(),
        price,
    )?;

    let fee = math::flat_fee(price, ctx.accounts.protocol.fee_bps)?;
    let net = price.saturating_sub(fee);

    let to_merchant = token_ops::protocol_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.protocol,
        &ctx.accounts.subscriber_token_account,
        &mut ctx.accounts.merchant_payout,
        net,
    )?;
    let to_treasury = token_ops::protocol_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.protocol,
        &ctx.accounts.subscriber_token_account,
        &mut ctx.accounts.treasury,
        fee,
    )?;

    let sub = &mut ctx.accounts.subscription;
    sub.periods_charged = sub.periods_charged.saturating_add(1);
    sub.missed_charges = 0;
    sub.next_charge_at += period;

    let merchant = &mut ctx.accounts.merchant;
    merchant.total_settled = merchant.total_settled.saturating_add(to_merchant);

    emit!(SubscriptionCharged {
        plan_id,
        subscriber: ctx.accounts.subscription.subscriber,
        amount: to_merchant.saturating_add(to_treasury),
        fee: to_treasury,
        period: ctx.accounts.subscription.periods_charged,
        next_charge_at: ctx.accounts.subscription.next_charge_at,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CancelSubscription<'info> {
    pub signer: Signer<'info>,

    #[account(seeds = [MERCHANT_SEED, merchant.authority.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,

    #[account(
        seeds = [PLAN_SEED, &plan.id.to_le_bytes()],
        bump = plan.bump,
        constraint = plan.merchant == merchant.key() @ PolarisError::NotAuthorized,
    )]
    pub plan: Account<'info, Plan>,

    #[account(
        mut,
        seeds = [SUB_SEED, subscription.subscriber.as_ref(), plan.key().as_ref()],
        bump = subscription.bump,
    )]
    pub subscription: Account<'info, Subscription>,
}

/// Cancel.
///
/// The subscriber can always do this unilaterally — it needs no merchant
/// cooperation, which is the property that makes the standing delegation safe
/// to grant in the first place. The merchant can also cancel, which is how a
/// merchant offboards.
pub fn cancel_handler(ctx: Context<CancelSubscription>) -> Result<()> {
    require!(
        ctx.accounts.subscription.status == SubStatus::Active,
        PolarisError::SubscriptionNotActive
    );
    let signer = ctx.accounts.signer.key();
    require!(
        signer == ctx.accounts.subscription.subscriber || signer == ctx.accounts.merchant.authority,
        PolarisError::NotAuthorized
    );

    ctx.accounts.subscription.status = SubStatus::Cancelled;

    emit!(SubscriptionCancelled {
        plan_id: ctx.accounts.plan.id,
        subscriber: ctx.accounts.subscription.subscriber,
        by: signer,
    });
    Ok(())
}
