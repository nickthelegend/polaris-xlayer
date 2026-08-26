use anchor_lang::prelude::*;

use crate::state::LoanStatus;

#[event]
pub struct LoanCreated {
    pub loan_id: u64,
    pub borrower: Pubkey,
    pub merchant: Pubkey,
    pub principal: u64,
    pub total_owed: u64,
    pub installments: u32,
    pub started_at: i64,
    pub interval_seconds: i64,
}

#[event]
pub struct InstallmentPaid {
    pub loan_id: u64,
    pub borrower: Pubkey,
    /// 0-based, to match `installment_due_at`, so an indexer can join the event
    /// to the schedule without an off-by-one.
    pub installment_index: u32,
    pub amount: u64,
    pub on_time: bool,
    /// Installments the money received actually covers, after this payment.
    pub installments_paid: u32,
    pub outstanding: u64,
}

#[event]
pub struct LoanFullyRepaid {
    pub loan_id: u64,
    pub borrower: Pubkey,
}

#[event]
pub struct LoanLiquidated {
    pub loan_id: u64,
    pub borrower: Pubkey,
    pub outstanding: u64,
    pub recovered: u64,
    pub bad_debt: u64,
}

#[event]
pub struct ScoreChanged {
    pub user: Pubkey,
    pub old_score: u16,
    pub new_score: u16,
    pub reason: String,
}

#[event]
pub struct CollateralLocked {
    pub user: Pubkey,
    pub amount: u64,
    pub new_total: u64,
}

#[event]
pub struct CollateralWithdrawn {
    pub user: Pubkey,
    pub amount: u64,
    pub new_total: u64,
}

#[event]
pub struct CollateralSeized {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct MerchantRegistered {
    pub merchant: Pubkey,
    pub authority: Pubkey,
    pub name: String,
}

#[event]
pub struct MerchantActivated {
    pub merchant: Pubkey,
    pub active: bool,
}

#[event]
pub struct PaymentMade {
    pub payer: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub order_ref: [u8; 32],
}

#[event]
pub struct PlanCreated {
    pub plan_id: u64,
    pub merchant: Pubkey,
    pub price_per_period: u64,
    pub period_seconds: i64,
}

#[event]
pub struct Subscribed {
    pub plan_id: u64,
    pub subscriber: Pubkey,
}

#[event]
pub struct SubscriptionCharged {
    pub plan_id: u64,
    pub subscriber: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub period: u32,
    pub next_charge_at: i64,
}

#[event]
pub struct ChargeMissed {
    pub plan_id: u64,
    pub subscriber: Pubkey,
    pub misses: u32,
    pub next_charge_at: i64,
    pub reason: String,
}

#[event]
pub struct SubscriptionLapsed {
    pub plan_id: u64,
    pub subscriber: Pubkey,
    pub misses: u32,
}

#[event]
pub struct SubscriptionCancelled {
    pub plan_id: u64,
    pub subscriber: Pubkey,
    pub by: Pubkey,
}

#[event]
pub struct LoanStatusChanged {
    pub loan_id: u64,
    pub status: LoanStatus,
}

#[event]
pub struct LiquidityFunded {
    pub from: Pubkey,
    pub amount: u64,
}

#[event]
pub struct LiquidityWithdrawn {
    pub to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct FeesSwept {
    pub to: Pubkey,
    pub amount: u64,
}
