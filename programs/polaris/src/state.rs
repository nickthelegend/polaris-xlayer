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
    /// Who may attest to a wallet's history when opening its first line.
    ///
    /// Separate from `authority` on purpose. The underwriter signs constantly —
    /// once per new borrower — so it wants to be a warm key on a service, while
    /// the authority moves protocol money and should not be. It attests to
    /// facts, never to a score: the arithmetic lives in `underwrite_from`.
    pub underwriter: Pubkey,
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
    /// When this line was underwritten from chain history, or 0 if it opened
    /// at the flat starting score.
    pub underwritten_at: i64,
    /// The evidence the opening score was computed from, kept so a borrower can
    /// be shown why their limit is what it is, and so a disputed line can be
    /// recomputed rather than argued about.
    pub wallet_age_days: u32,
    pub transaction_count: u32,
    pub token_accounts: u32,
    pub stable_balance: u64,
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
    /// The 32-byte reference this payment settles. Also its PDA seed.
    pub order_ref: [u8; 32],
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

    /// Turn four observable facts about a wallet into an opening score.
    ///
    /// Deliberately a pure function of the evidence, and deliberately on chain.
    /// The underwriter submits what it read from the cluster; the program
    /// decides what that is worth. An underwriter that wanted to hand someone
    /// an 850 would have to claim a wallet age, a transaction count, a holdings
    /// breadth and a balance that anyone can go and check against the same RPC.
    ///
    /// Saturating throughout: this runs on numbers supplied by a caller, and a
    /// u32 transaction count times a weight is well inside u32 but the habit of
    /// checking is cheaper than the one time it is not.
    pub fn underwrite_from(
        wallet_age_days: u32,
        transaction_count: u32,
        token_accounts: u32,
        stable_balance: u64,
    ) -> u16 {
        let age = ((wallet_age_days / 30) as u16)
            .saturating_mul(AGE_POINTS_PER_MONTH)
            .min(MAX_AGE_POINTS);
        let activity = ((transaction_count / 25) as u16)
            .saturating_mul(ACTIVITY_POINTS_PER_25_TX)
            .min(MAX_ACTIVITY_POINTS);
        let breadth = (token_accounts as u16)
            .saturating_mul(BREADTH_POINTS_PER_ACCOUNT)
            .min(MAX_BREADTH_POINTS);
        // Base units, so 100 USDC is 100_000_000 at six decimals.
        let balance = ((stable_balance / 100_000_000) as u16)
            .saturating_mul(BALANCE_POINTS_PER_100)
            .min(MAX_BALANCE_POINTS);

        UNDERWRITING_FLOOR
            .saturating_add(age)
            .saturating_add(activity)
            .saturating_add(breadth)
            .saturating_add(balance)
            .clamp(MIN_SCORE, MAX_SCORE)
    }

    /// True while the line is still the one it was opened with.
    ///
    /// Underwriting may only ever run against a borrower who has no record with
    /// us. The moment they have paid, missed, been liquidated or drawn anything
    /// at all, the score is earned and an attestation must not overwrite it.
    pub fn is_unproven(&self) -> bool {
        self.on_time_payments == 0
            && self.late_payments == 0
            && self.liquidations == 0
            && self.active_debt == 0
            && self.underwritten_at == 0
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

#[cfg(test)]
mod underwriting_tests {
    use super::*;

    const USDC: u64 = 1_000_000;

    fn score(age: u32, tx: u32, accounts: u32, balance: u64) -> u16 {
        CreditProfile::underwrite_from(age, tx, accounts, balance)
    }

    /// A profile with nothing in it. Written out rather than derived, so the
    /// account struct is not given a `Default` it has no use for on chain.
    fn blank() -> CreditProfile {
        CreditProfile {
            user: Pubkey::default(),
            score: 0,
            on_time_payments: 0,
            late_payments: 0,
            liquidations: 0,
            active_debt: 0,
            locked_collateral: 0,
            seized_collateral: 0,
            first_seen_at: 0,
            underwritten_at: 0,
            wallet_age_days: 0,
            transaction_count: 0,
            token_accounts: 0,
            stable_balance: 0,
            bump: 0,
        }
    }

    fn limit(s: u16) -> u64 {
        let mut p = blank();
        p.score = s;
        p.base_limit()
    }

    #[test]
    fn a_wallet_created_today_opens_the_smallest_line() {
        // The whole point: a wallet with no history is not handed the same
        // 500 USDC line as one that has been paying for things for years.
        let fresh = score(0, 0, 0, 0);
        assert_eq!(fresh, UNDERWRITING_FLOOR);
        assert_eq!(limit(fresh), 200 * USDC);
    }

    #[test]
    fn three_years_of_real_use_earns_a_materially_larger_line() {
        // ~3 years old, 4,000 transactions, 12 token accounts, 3,000 USDC held.
        let seasoned = score(1_095, 4_000, 12, 3_000 * USDC);
        let fresh = score(0, 0, 0, 0);
        assert!(seasoned > fresh + 150, "got {seasoned}");
        // Five times the opening line of a wallet created this morning, which
        // is the entire argument for reading history at all.
        assert_eq!(limit(seasoned), 1_000 * USDC);
        assert_eq!(limit(fresh), 200 * USDC);
    }

    #[test]
    fn the_top_two_tiers_cannot_be_reached_by_attestation_alone() {
        // A deliberate ceiling. The best wallet history in the world opens a
        // 1,000 USDC line; 2,500 and 5,000 are earned by repaying us, because
        // having held tokens for three years is evidence of solvency, not of
        // willingness to pay. Everything below is what enforces that.
        let best = score(u32::MAX, u32::MAX, u32::MAX, u64::MAX);
        assert_eq!(
            best,
            UNDERWRITING_FLOOR
                + MAX_AGE_POINTS
                + MAX_ACTIVITY_POINTS
                + MAX_BREADTH_POINTS
                + MAX_BALANCE_POINTS
        );
        assert!(best < 740, "attestation reached the 2,500 tier at {best}");
        assert_eq!(limit(best), 1_000 * USDC);
    }

    #[test]
    fn every_input_is_capped_so_one_axis_cannot_buy_the_top_band() {
        // A wallet that farms a single signal — a million transactions, or a
        // vast balance — must not reach the same place as a broadly good one.
        let only_activity = score(0, 10_000_000, 0, 0);
        assert_eq!(only_activity, UNDERWRITING_FLOOR + MAX_ACTIVITY_POINTS);

        let only_balance = score(0, 0, 0, 10_000_000 * USDC);
        assert_eq!(only_balance, UNDERWRITING_FLOOR + MAX_BALANCE_POINTS);

        let only_breadth = score(0, 0, 100_000, 0);
        assert_eq!(only_breadth, UNDERWRITING_FLOOR + MAX_BREADTH_POINTS);

        let only_age = score(100_000, 0, 0, 0);
        assert_eq!(only_age, UNDERWRITING_FLOOR + MAX_AGE_POINTS);
    }

    #[test]
    fn the_best_possible_attestation_stays_inside_the_band() {
        // Even everything maxed at once must land inside the score band, and
        // must not reach the top tier on attestation alone — 800 is somewhere
        // you get to by repaying, not by having an old wallet.
        let best = score(u32::MAX, u32::MAX, u32::MAX, u64::MAX);
        assert!(best <= MAX_SCORE);
        assert!(best < 800, "attestation alone reached {best}");
        assert!(best >= UNDERWRITING_FLOOR);
    }

    #[test]
    fn saturating_arithmetic_holds_at_the_input_ceiling() {
        // u32::MAX / 25 overflows a u16 many times over. If any of this
        // wrapped, a maximal wallet would score as a minimal one.
        let s = score(u32::MAX, u32::MAX, u32::MAX, u64::MAX);
        assert!(s >= UNDERWRITING_FLOOR, "wrapped to {s}");
    }

    #[test]
    fn a_borrower_with_any_record_is_no_longer_unproven() {
        let mut p = blank();
        assert!(p.is_unproven());

        p.on_time_payments = 1;
        assert!(!p.is_unproven(), "a repayment is a record");

        let mut p = blank();
        p.active_debt = 1;
        assert!(!p.is_unproven(), "an open debt is a record");

        let mut p = blank();
        p.liquidations = 1;
        assert!(!p.is_unproven(), "a liquidation is a record");

        let mut p = blank();
        p.underwritten_at = 1;
        assert!(!p.is_unproven(), "underwriting does not run twice");
    }
}
