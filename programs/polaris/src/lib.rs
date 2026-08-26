//! # Polaris
//!
//! A payments layer with credit built in: pay in full, subscribe, or split a
//! purchase into installments against an undercollateralized credit line.
//!
//! This is the Solana build. The EVM original is five Solidity contracts plus
//! KeeperHub, an external execution platform. Two structural things changed,
//! and both are in `docs/SOLANA-PORT.md` in full:
//!
//! **One program, not five contracts.** `setWriter`, `setSeizer`,
//! `setOriginator`, `setCollateralVault` and `setMerchantRegistry` all exist on
//! EVM because Solidity contracts are mutually distrustful and have to be
//! granted permission over each other's state. Inside one program that distrust
//! is meaningless, so all five setters — and the class of bug where a
//! deployment half-wires itself and lending silently breaks — are gone.
//!
//! **The keeper is a scheduler, not an execution platform.** Simulation,
//! atomic check-and-execute, fee sponsorship and replay protection are runtime
//! features here rather than a product. What is left off-chain is deciding
//! what is due and handling why a charge failed.
//!
//! The collection model is a pull. At checkout the borrower delegates their
//! token account to the protocol PDA once, and every later installment is drawn
//! against that delegation without the borrower being online. That is the whole
//! product, and `docs/SOLANA-PORT.md` covers what SPL delegation does and does
//! not give us compared to an ERC-20 allowance.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;
pub mod token_ops;

use instructions::*;

declare_id!("9wgqMhXvhzzDaLEWxXsQRx73CMtSUKRrVYL6Vy1cDKAU");

#[program]
pub mod polaris {
    use super::*;

    // -- protocol ---------------------------------------------------------

    pub fn initialize(
        ctx: Context<Initialize>,
        grace_period: i64,
        fee_bps: u16,
        credit_multiplier_bps: u16,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, grace_period, fee_bps, credit_multiplier_bps)
    }

    pub fn set_config(
        ctx: Context<SetConfig>,
        fee_bps: u16,
        credit_multiplier_bps: u16,
    ) -> Result<()> {
        instructions::initialize::set_config_handler(ctx, fee_bps, credit_multiplier_bps)
    }

    // -- liquidity --------------------------------------------------------

    pub fn fund_liquidity(ctx: Context<FundLiquidity>, amount: u64) -> Result<()> {
        instructions::liquidity::fund_handler(ctx, amount)
    }

    pub fn withdraw_liquidity(ctx: Context<WithdrawLiquidity>, amount: u64) -> Result<()> {
        instructions::liquidity::withdraw_liquidity_handler(ctx, amount)
    }

    pub fn sweep_fees(ctx: Context<SweepFees>) -> Result<()> {
        instructions::liquidity::sweep_fees_handler(ctx)
    }

    // -- merchants --------------------------------------------------------

    pub fn register_merchant(
        ctx: Context<RegisterMerchant>,
        name: String,
        metadata_uri: String,
    ) -> Result<()> {
        instructions::merchant::register_handler(ctx, name, metadata_uri)
    }

    pub fn set_merchant_active(ctx: Context<AdminMerchant>, active: bool) -> Result<()> {
        instructions::merchant::set_active_handler(ctx, active)
    }

    pub fn set_merchant_max_order(ctx: Context<AdminMerchant>, max_order_value: u64) -> Result<()> {
        instructions::merchant::set_max_order_handler(ctx, max_order_value)
    }

    pub fn update_payout_address(ctx: Context<UpdatePayout>) -> Result<()> {
        instructions::merchant::update_payout_handler(ctx)
    }

    // -- collateral -------------------------------------------------------

    pub fn lock_collateral(ctx: Context<LockCollateral>, amount: u64) -> Result<()> {
        instructions::collateral::lock_handler(ctx, amount)
    }

    pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
        instructions::collateral::withdraw_collateral_handler(ctx, amount)
    }

    // -- credit -----------------------------------------------------------

    pub fn create_loan(
        ctx: Context<CreateLoan>,
        principal: u64,
        installment_count: u32,
        interval_seconds: i64,
    ) -> Result<()> {
        instructions::loan::create_handler(ctx, principal, installment_count, interval_seconds)
    }

    /// Permissionless. Collects exactly the installment that is due.
    pub fn collect_installment(ctx: Context<CollectInstallment>) -> Result<()> {
        instructions::loan::collect_handler(ctx)
    }

    /// Borrower-signed. Any amount, including early payoff.
    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        instructions::loan::repay_handler(ctx, amount)
    }

    /// Permissionless. The condition is checked inside the instruction, so
    /// there is no window between the check and the action.
    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        instructions::loan::liquidate_handler(ctx)
    }

    // -- pay now ----------------------------------------------------------

    /// `order_hash` must be sha256(`order_id`). It addresses the payment
    /// account, which is what makes a retried checkout idempotent.
    pub fn pay(
        ctx: Context<Pay>,
        amount: u64,
        order_id: String,
        order_hash: [u8; 32],
    ) -> Result<()> {
        instructions::payments::pay_handler(ctx, amount, order_id, order_hash)
    }

    // -- subscriptions ----------------------------------------------------

    pub fn create_plan(
        ctx: Context<CreatePlan>,
        price_per_period: u64,
        period_seconds: i64,
        name: String,
    ) -> Result<()> {
        instructions::subscription::create_plan_handler(ctx, price_per_period, period_seconds, name)
    }

    pub fn deactivate_plan(ctx: Context<DeactivatePlan>) -> Result<()> {
        instructions::subscription::deactivate_plan_handler(ctx)
    }

    pub fn subscribe(ctx: Context<Subscribe>) -> Result<()> {
        instructions::subscription::subscribe_handler(ctx)
    }

    /// Permissionless. The subscription analogue of `collect_installment`.
    pub fn charge_due(ctx: Context<ChargeDue>) -> Result<()> {
        instructions::subscription::charge_due_handler(ctx)
    }

    pub fn cancel_subscription(ctx: Context<CancelSubscription>) -> Result<()> {
        instructions::subscription::cancel_handler(ctx)
    }
}
