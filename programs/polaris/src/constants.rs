//! Protocol constants. These mirror the Solidity build one-for-one so the two
//! implementations can be diffed on behaviour rather than on numbers.

/// Annualised interest, in basis points.
pub const INTEREST_RATE_BPS: u64 = 1_000; // 10%
/// Share of *interest* kept by the protocol. Never a share of principal.
pub const PROTOCOL_FEE_BPS: u64 = 2_000; // 20%

/// Default grace period when the deployer does not specify one.
pub const DEFAULT_GRACE_PERIOD: i64 = 3 * 86_400;
/// Upper bound, so a misconfigured deployment cannot make loans effectively
/// un-liquidatable.
pub const MAX_GRACE_PERIOD: i64 = 30 * 86_400;

/// Installment schedule bounds.
pub const MAX_INSTALLMENTS: u32 = 24;
pub const MAX_INTERVAL_SECONDS: i64 = 365 * 86_400;

/// Default floor on an installment interval, when the deployer does not pick
/// one. An hour is right for a consumer book.
pub const DEFAULT_MIN_INTERVAL_SECONDS: i64 = 3_600;

/// Absolute floor, below which no deployment may go.
///
/// The interval floor is per-deployment for exactly the reason the grace period
/// is: a consumer book wants days between installments, a machine-to-machine
/// book genuinely wants minutes, and a devnet deployment wants seconds so the
/// collection and liquidation paths can be demonstrated without waiting a week.
/// Hard-coding an hour made all three the same book.
///
/// It is still a floor rather than a free parameter. Below a minute the
/// schedule stops being a payment plan and starts being a way to grind a
/// borrower's balance one transaction at a time.
pub const ABSOLUTE_MIN_INTERVAL_SECONDS: i64 = 60;

/// Credit score band.
pub const MIN_SCORE: u16 = 300;
pub const MAX_SCORE: u16 = 850;
pub const STARTING_SCORE: u16 = 600;

/// Deliberately asymmetric: trust is slow to earn and fast to lose, which is
/// both how real credit bureaus behave and the correct bias for an
/// undercollateralized book.
pub const ON_TIME_BONUS: u16 = 12;
pub const LATE_PENALTY: u16 = 40;
pub const DEFAULT_PENALTY: u16 = 150;

/// Payments fee, in basis points, and its ceiling.
pub const DEFAULT_FEE_BPS: u16 = 50; // 0.5%
pub const MAX_FEE_BPS: u16 = 500;

/// Basis points of credit granted per unit of locked collateral.
pub const DEFAULT_CREDIT_MULTIPLIER_BPS: u16 = 15_000; // 150%
pub const MAX_CREDIT_MULTIPLIER_BPS: u16 = 30_000;

/// A brand new merchant should not be able to originate unlimited credit.
pub const DEFAULT_MAX_ORDER_VALUE: u64 = 500_000_000; // 500 USDC

/// How long after the due time a subscription charge may still be collected.
/// Past this the period is skipped rather than stacked.
pub const CHARGE_WINDOW: i64 = 7 * 86_400;
/// Consecutive misses before a subscription lapses.
pub const MAX_MISSES: u32 = 3;

/// PDA seeds.
pub const PROTOCOL_SEED: &[u8] = b"protocol";
pub const LIQUIDITY_SEED: &[u8] = b"liquidity";
pub const COLLATERAL_SEED: &[u8] = b"collateral_vault";
pub const PROFILE_SEED: &[u8] = b"profile";
pub const LOAN_SEED: &[u8] = b"loan";
pub const MERCHANT_SEED: &[u8] = b"merchant";
pub const PLAN_SEED: &[u8] = b"plan";
pub const SUB_SEED: &[u8] = b"sub";
pub const PAYMENT_SEED: &[u8] = b"payment";

/// String caps, so account sizes are fixed at declaration.
pub const MAX_NAME_LEN: usize = 64;
pub const MAX_URI_LEN: usize = 128;
/// An order reference is exactly 32 bytes.
///
/// Not a string, and not a digest the program recomputes. Both of those were
/// tried. A string has to be capped somewhere and then hashed into the seed,
/// which means carrying a digest alongside it and checking they agree — and a
/// caller who passes a digest belonging to a different order can occupy the
/// address a legitimate payment needed. One 32-byte identifier makes that
/// mismatch unrepresentable.
///
/// Short order ids go in directly as UTF-8, left-padded with zeros; anything
/// longer is hashed to 32 bytes by the caller. The SDK's `orderRef` does both.
pub const ORDER_REF_LEN: usize = 32;
