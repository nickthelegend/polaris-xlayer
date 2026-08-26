//! Schedule and fee arithmetic.
//!
//! Every function here takes plain integers and returns plain integers, so the
//! rules that cost real money are unit-testable on the host without a validator
//! and diffable against the Solidity original line by line.
//!
//! Widening to `u128` is not defensive habit. `principal * INTEREST_RATE_BPS *
//! term_seconds` overflows `u64` at entirely ordinary inputs — a 5,000 USDC
//! loan over a year is 5e9 * 1e3 * 3.15e7 ≈ 1.6e20, and `u64::MAX` is 1.8e19.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::PolarisError;

const SECONDS_PER_YEAR: u128 = 365 * 86_400;

fn narrow(v: u128) -> Result<u64> {
    u64::try_from(v).map_err(|_| error!(PolarisError::MathOverflow))
}

/// Interest over the full term, annualised and pro-rated.
///
/// Pro-rating is the whole point. A flat percentage of the loan would make a
/// 30-day plan cost the same as a 365-day one.
pub fn interest_for(principal: u64, term_seconds: i64) -> Result<u64> {
    require!(term_seconds > 0, PolarisError::InvalidInterval);
    let num = (principal as u128)
        .checked_mul(INTEREST_RATE_BPS as u128)
        .and_then(|x| x.checked_mul(term_seconds as u128))
        .ok_or(error!(PolarisError::MathOverflow))?;
    narrow(num / (10_000u128 * SECONDS_PER_YEAR))
}

/// Cumulative amount that must have been repaid for `k` installments to count
/// as complete.
///
/// **Rounded up**, and the schedule and the progress check both read from this
/// one function. An earlier Solidity version computed the installment amount by
/// rounding down and inferred progress by rounding down again, so a full
/// payment landed one base unit short of its own threshold and counted as zero.
/// One canonical ladder removes that class of bug entirely.
pub fn threshold_for(total_owed: u64, installment_count: u32, k: u32) -> u64 {
    if k == 0 {
        return 0;
    }
    if k >= installment_count || installment_count == 0 {
        return total_owed;
    }
    let num = (total_owed as u128) * (k as u128);
    let den = installment_count as u128;
    // Ceiling division. `num + den - 1` cannot overflow u128 at u64 inputs.
    ((num + den - 1) / den) as u64
}

/// How many installments the money actually received covers.
///
/// Derived from `total_repaid`, never incremented per call. Incrementing was
/// exploitable: a borrower could call repay with one base unit, four times, and
/// a 4-installment loan would show 4/4 collected while the balance was still
/// owed — and because the liquidation check returns false once
/// `installments_paid` reaches `installment_count`, the loan became permanently
/// un-liquidatable. Dust bought immunity.
///
/// The loop is bounded by `MAX_INSTALLMENTS`, enforced at origination.
pub fn installments_earned(total_repaid: u64, total_owed: u64, installment_count: u32) -> u32 {
    let mut k: u32 = 0;
    while k < installment_count && total_repaid >= threshold_for(total_owed, installment_count, k + 1)
    {
        k += 1;
    }
    k
}

/// Amount due to complete the next unpaid installment.
pub fn installment_amount(
    total_repaid: u64,
    total_owed: u64,
    installment_count: u32,
    installments_paid: u32,
) -> u64 {
    if installments_paid >= installment_count {
        return 0;
    }
    let target = threshold_for(total_owed, installment_count, installments_paid + 1);
    target.saturating_sub(total_repaid)
}

/// When installment `index` (0-based) becomes collectable.
pub fn installment_due_at(started_at: i64, interval_seconds: i64, index: u32) -> i64 {
    started_at + (index as i64 + 1) * interval_seconds
}

/// The protocol's share of *actual* interest, accrued proportionally as money
/// arrives.
///
/// The Solidity original once treated 10% of every repayment as interest and
/// took 20% of that — roughly 2% of the whole loan. Real interest is annualised
/// and pro-rated over the term, so on any plan shorter than about 75 days the
/// fee exceeded every penny of interest earned and the difference came out of
/// merchant-payout liquidity. A 200 USDC loan over 40 days repaid perfectly on
/// time still lost the pool money.
pub fn fee_on_payment(amount: u64, principal: u64, total_owed: u64) -> Result<u64> {
    let total_interest = total_owed.saturating_sub(principal);
    if total_interest == 0 || total_owed == 0 {
        return Ok(0);
    }
    let num = (amount as u128)
        .checked_mul(total_interest as u128)
        .and_then(|x| x.checked_mul(PROTOCOL_FEE_BPS as u128))
        .ok_or(error!(PolarisError::MathOverflow))?;
    let den = (total_owed as u128) * 10_000u128;
    narrow(num / den)
}

/// Flat basis-point fee on a direct payment or subscription charge.
pub fn flat_fee(amount: u64, fee_bps: u16) -> Result<u64> {
    let num = (amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(error!(PolarisError::MathOverflow))?;
    narrow(num / 10_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    const USDC: u64 = 1_000_000;

    #[test]
    fn interest_is_prorated_not_flat() {
        // 10% annualised on 1000 USDC over exactly one year.
        let year = interest_for(1_000 * USDC, 365 * 86_400).unwrap();
        assert_eq!(year, 100 * USDC);
        // Half the term, half the interest.
        let half = interest_for(1_000 * USDC, 182 * 86_400 + 12 * 3_600).unwrap();
        assert_eq!(half, 50 * USDC);
        // A 30-day plan must not cost the same as a 365-day one.
        let month = interest_for(1_000 * USDC, 30 * 86_400).unwrap();
        assert!(month < year / 10);
    }

    #[test]
    fn interest_does_not_overflow_at_the_ceiling() {
        // The input that overflows u64 if the intermediate is not widened.
        let i = interest_for(5_000 * USDC, 365 * 86_400).unwrap();
        assert_eq!(i, 500 * USDC);
    }

    #[test]
    fn thresholds_are_ceiled_and_sum_to_the_whole() {
        // 100 over 3 does not divide evenly. Every threshold must round up, and
        // the last must land exactly on the total.
        let owed = 100;
        assert_eq!(threshold_for(owed, 3, 0), 0);
        assert_eq!(threshold_for(owed, 3, 1), 34);
        assert_eq!(threshold_for(owed, 3, 2), 67);
        assert_eq!(threshold_for(owed, 3, 3), 100);
        // Past the end still clamps to the total.
        assert_eq!(threshold_for(owed, 3, 9), 100);
    }

    #[test]
    fn a_full_installment_payment_always_counts() {
        // The exact bug the canonical ladder exists to prevent: paying the
        // quoted installment amount must always complete at least the
        // installment it was quoted for, for every schedule shape, with no
        // off-by-one — and the schedule must terminate having collected exactly
        // what was owed, never more and never less.
        //
        // "At least one" rather than "exactly one" is deliberate. When
        // `total_owed` is smaller than `installment_count` — a 1-base-unit loan
        // split four ways — ceiling the thresholds makes the first payment
        // settle the whole balance, so it legitimately closes several
        // installments at once. That is correct: the loan is paid off and
        // closes. Asserting one-per-payment would be asserting a rounding
        // artifact, not the invariant.
        for count in 1..=MAX_INSTALLMENTS {
            for owed in [1u64, 2, 7, 23, 99, 100, 12_345, 1_000 * USDC, 999_999_999] {
                let mut repaid = 0u64;
                let mut paid = 0u32;
                let mut payments = 0u32;

                while paid < count {
                    let due = installment_amount(repaid, owed, count, paid);
                    assert!(
                        due > 0,
                        "count={count} owed={owed} paid={paid} quoted a zero installment"
                    );
                    repaid += due;
                    payments += 1;

                    let earned = installments_earned(repaid, owed, count);
                    assert!(
                        earned > paid,
                        "count={count} owed={owed} paid={paid} due={due} made no progress"
                    );
                    paid = earned;
                    assert!(
                        payments <= count,
                        "count={count} owed={owed} took more payments than installments"
                    );
                }

                assert_eq!(paid, count, "count={count} owed={owed} did not finish");
                assert_eq!(repaid, owed, "count={count} owed={owed} over/under-collected");
            }
        }
    }

    #[test]
    fn a_loan_smaller_than_its_schedule_closes_on_the_first_payment() {
        // The shape that broke the loop above, pinned as its own case so the
        // behaviour is documented rather than merely tolerated.
        assert_eq!(installment_amount(0, 1, 4, 0), 1);
        assert_eq!(installments_earned(1, 1, 4), 4);
        // And it is genuinely settled — not marked paid while money is owed.
        assert_eq!(threshold_for(1, 4, 4), 1);
    }

    #[test]
    fn dust_cannot_buy_liquidation_immunity() {
        // Four one-unit payments against a 4-installment, 200 USDC loan must
        // earn zero installments — not four.
        let owed = 200 * USDC;
        assert_eq!(installments_earned(4, owed, 4), 0);
        // Even one unit short of the first threshold earns nothing.
        let first = threshold_for(owed, 4, 1);
        assert_eq!(installments_earned(first - 1, owed, 4), 0);
        assert_eq!(installments_earned(first, owed, 4), 1);
    }

    #[test]
    fn progress_is_monotonic_in_money_received() {
        let owed = 12_345u64;
        let mut last = 0u32;
        for repaid in 0..=owed {
            let e = installments_earned(repaid, owed, 7);
            assert!(e >= last);
            last = e;
        }
        assert_eq!(last, 7);
    }

    #[test]
    fn protocol_fee_never_exceeds_interest_earned() {
        // The regression that cost the pool money: over the life of a loan the
        // fees taken must never exceed PROTOCOL_FEE_BPS of the real interest.
        for days in [7i64, 30, 40, 75, 180, 365] {
            let principal = 200 * USDC;
            let term = days * 86_400;
            let interest = interest_for(principal, term).unwrap();
            let owed = principal + interest;

            let mut fees = 0u64;
            for _ in 0..4 {
                fees += fee_on_payment(owed / 4, principal, owed).unwrap();
            }
            let cap = (interest as u128 * PROTOCOL_FEE_BPS as u128 / 10_000) as u64;
            assert!(
                fees <= cap,
                "days={days} fees={fees} exceeded 20% of interest {cap}"
            );
        }
    }

    #[test]
    fn zero_interest_loan_accrues_no_fee() {
        assert_eq!(fee_on_payment(100, 100, 100).unwrap(), 0);
    }

    #[test]
    fn due_dates_are_one_interval_apart_starting_at_one() {
        let start = 1_700_000_000i64;
        let iv = 86_400i64;
        assert_eq!(installment_due_at(start, iv, 0), start + iv);
        assert_eq!(installment_due_at(start, iv, 3), start + 4 * iv);
    }
}
