use anchor_lang::prelude::*;

#[error_code]
pub enum PolarisError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Installment count must be between 1 and 24")]
    InvalidInstallments,
    #[msg("Interval must be between 1 hour and 365 days")]
    InvalidInterval,
    #[msg("Grace period exceeds the maximum")]
    InvalidGracePeriod,
    #[msg("Fee exceeds the maximum")]
    InvalidFee,
    #[msg("Credit multiplier is zero or exceeds the maximum")]
    InvalidMultiplier,
    #[msg("Loan is not active")]
    LoanNotActive,
    #[msg("Loan does not meet the liquidation condition")]
    NotLiquidatable,
    #[msg("Borrowing this would exceed the credit limit")]
    ExceedsCreditLimit,
    #[msg("Merchant is inactive or the order exceeds its cap")]
    MerchantNotEligible,
    #[msg("Insufficient protocol liquidity to pay the merchant")]
    InsufficientLiquidity,
    #[msg("Collateral balance is too low")]
    InsufficientCollateral,
    #[msg("Collateral is locked while debt is outstanding")]
    DebtOutstanding,
    #[msg("Subscription plan is not active")]
    PlanNotActive,
    #[msg("Already subscribed to this plan")]
    AlreadySubscribed,
    #[msg("Subscription is not active")]
    SubscriptionNotActive,
    #[msg("Subscription charge is not due yet")]
    NotDue,
    #[msg("Caller is neither the subscriber nor the merchant")]
    NotAuthorized,
    #[msg("Period must be between 1 hour and 365 days")]
    InvalidPeriod,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("String exceeds its maximum length")]
    StringTooLong,
    /// The Solana analogue of ERC-20 `InsufficientAllowance`. Distinct from a
    /// missing delegate so the dunning ladder can tell "borrower revoked us"
    /// from "the delegation ran dry".
    #[msg("Token account is not delegated to the protocol")]
    NotDelegated,
    #[msg("Delegated amount does not cover what is owed")]
    InsufficientDelegation,
    #[msg("Token account owner does not match the expected party")]
    TokenOwnerMismatch,
    #[msg("Token account mint is not the protocol stablecoin")]
    MintMismatch,
}
