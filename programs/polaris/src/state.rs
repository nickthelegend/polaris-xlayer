use anchor_lang::prelude::*;

use crate::constants::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum LoanStatus {
    Active,
    Repaid,
    Liquidated,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum SubStatus {
    Active,
    Cancelled,
    Lapsed,
}

/// Global configuration and the protocol's own ledgers.
///
/// This PDA is also the authority on the liquidity and collateral vaults, and
/// the delegate every borrower approves. One signer for the whole protocol.
#[account]
#[derive(InitSpace)]
pub struct Protocol {
    pub authority: Pubkey,
    /// The stablecoin mint. Every token account the protocol touches must match.
    pub stablecoin: Pubkey,
    /// Where protocol fees are swept. A token account, not a wallet.
    pub treasury: Pubkey,
    /// How long an installment may be overdue before the loan is liquidatable.
    ///
    /// Set at initialization rather than as a constant: a consumer book wants
    /// days, a machine-to-machine book wants minutes, and a devnet deployment
    /// wants seconds so the liquidation path can be demonstrated without
    /// waiting three days.
    pub grace_period: i64,
    /// Floor on an installment interval and a subscription period. Fixed at
    /// initialization, like the grace period, so it cannot be lowered under a
    /// schedule that is already running.
    pub min_interval_seconds: i64,
    pub loan_count: u64,
    pub plan_count: u64,
    pub payment_count: u64,
    pub subscription_count: u64,
    /// Accrued protocol share of interest, not yet swept.
    pub protocol_fees_accrued: u64,
    /// Unrecovered value from liquidations. The protocol's own loss ledger.
    pub bad_debt: u64,
    /// Fee on direct payments and subscription charges.
    pub fee_bps: u16,
    /// Basis points of credit granted per unit of locked collateral.
    pub credit_multiplier_bps: u16,
    pub bump: u8,
    pub liquidity_bump: u8,
    pub collateral_bump: u8,
}

/// Per-user credit state.
///
/// On EVM this was split across `ScoreManager._profiles`,
/// `LoanEngine.activeDebtOf` and `CollateralVault.lockedOf` — three contracts
/// that had to be kept consistent with each other through `setWriter` and
/// `setSeizer` grants. Inside one program they are one account, so the
/// consistency problem does not exist.
#[account]
#[derive(InitSpace)]
pub struct CreditProfile {
    pub user: Pubkey,
    pub score: u16,
    pub on_time_payments: u32,
    pub late_payments: u32,
    pub liquidations: u32,
    /// Everything this user currently owes across every open plan.
    pub active_debt: u64,
    pub locked_collateral: u64,
    /// Set when a liquidation seizes collateral, so it cannot be double-seized.
    pub seized_collateral: u64,
    pub first_seen_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Loan {
    pub id: u64,
    pub borrower: Pubkey,
    /// The merchant's registry PDA, not their wallet.
    pub merchant: Pubkey,
    /// The token account the borrower is charged from. Pinned at origination so
    /// a keeper cannot be pointed at a different account later.
    pub borrower_token_account: Pubkey,
    pub principal: u64,
    pub total_owed: u64,
    pub total_repaid: u64,
    pub installment_count: u32,
    pub installments_paid: u32,
    pub started_at: i64,
    pub interval_seconds: i64,
    pub status: LoanStatus,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Merchant {
    pub authority: Pubkey,
    /// Token account that receives settlement.
    pub payout: Pubkey,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_URI_LEN)]
    pub metadata_uri: String,
    /// BNPL exposure is a function of who is selling as much as who is buying.
    pub max_order_value: u64,
    pub total_settled: u64,
    pub registered_at: i64,
    pub active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Plan {
    pub id: u64,
    /// The merchant registry PDA that owns this plan.
    pub merchant: Pubkey,
    pub price_per_period: u64,
    pub period_seconds: i64,
    pub active: bool,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    pub bump: u8,
}

/// Seeded by (subscriber, plan), so one live subscription per pair is a
/// property of the address rather than a check that can be forgotten.
#[account]
#[derive(InitSpace)]
pub struct Subscription {
    pub subscriber: Pubkey,
    pub plan: Pubkey,
    pub subscriber_token_account: Pubkey,
    pub started_at: i64,
    pub next_charge_at: i64,
    pub periods_charged: u32,
    pub missed_charges: u32,
    pub status: SubStatus,
    pub bump: u8,
}

/// Seeded by (merchant, order id), so a retrying checkout cannot pay twice:
/// the second `init` fails because the address is already occupied.
#[account]
#[derive(InitSpace)]
pub struct Payment {
    pub payer: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub paid_at: i64,
    pub bump: u8,
}

impl CreditProfile {
    /// Credit limit from score alone, in stablecoin base units.
    ///
    /// Piecewise rather than linear so the jumps are legible to a user ("get to
    /// 700 and your limit doubles") instead of a smooth curve nobody can reason
    /// about.
    pub fn base_limit(&self) -> u64 {
        match self.score {
            s if s >= 800 => 5_000_000_000,
            s if s >= 740 => 2_500_000_000,
            s if s >= 670 => 1_000_000_000,
            s if s >= 580 => 500_000_000,
            _ => 200_000_000,
        }
    }

    /// Extra credit this user's locked collateral is worth.
    pub fn collateral_boost(&self, multiplier_bps: u16) -> u64 {
        ((self.locked_collateral as u128 * multiplier_bps as u128) / 10_000) as u64
    }

    /// The limit a borrower can actually draw. The single number the program,
    /// the SDK and both UIs read, so a borrower is never shown one limit and
    /// refused at another.
    pub fn credit_limit(&self, multiplier_bps: u16) -> u64 {
        self.base_limit()
            .saturating_add(self.collateral_boost(multiplier_bps))
    }

    pub fn seed_if_new(&mut self, user: Pubkey, now: i64, bump: u8) {
        if self.first_seen_at == 0 {
            self.user = user;
            self.score = STARTING_SCORE;
            self.first_seen_at = now;
            self.bump = bump;
        }
    }

    fn adjust(&mut self, delta: i32) {
        let next = self.score as i32 + delta;
        self.score = next.clamp(MIN_SCORE as i32, MAX_SCORE as i32) as u16;
    }

    pub fn record_on_time(&mut self) {
        self.on_time_payments = self.on_time_payments.saturating_add(1);
        self.adjust(ON_TIME_BONUS as i32);
    }

    pub fn record_late(&mut self) {
        self.late_payments = self.late_payments.saturating_add(1);
        self.adjust(-(LATE_PENALTY as i32));
    }

    pub fn record_liquidation(&mut self) {
        self.liquidations = self.liquidations.saturating_add(1);
        self.adjust(-(DEFAULT_PENALTY as i32));
    }
}
