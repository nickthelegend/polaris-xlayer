// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ScoreManager} from "./ScoreManager.sol";

interface ICollateralSeize {
    function seize(address user, uint256 amount, address to) external returns (uint256);
}

interface IMerchantChecks {
    function canOriginate(address merchant, uint256 orderValue) external view returns (bool);
    function recordSettlement(address merchant, uint256 amount) external;
}

/**
 * @title PolarisLoanEngine
 * @notice Undercollateralized BNPL. A borrower splits a purchase into equal
 *         installments; the merchant is paid up front from protocol liquidity;
 *         the keeper collects each installment when it falls due.
 *
 * @dev The collection model is a pull, not a push. At checkout the borrower
 *      approves this contract for the full repayment amount once, and each
 *      installment is drawn with transferFrom. That is what lets a keeper
 *      collect on schedule without the borrower being online -- and it is why
 *      `repay` is callable by anyone: the funds can only ever move from the
 *      borrower to this contract, so a third-party caller is harmless and
 *      keeps the keeper permissionless.
 *
 *      Two functions exist purely for the keeper and are the reason this
 *      protocol maps cleanly onto KeeperHub's check-and-execute:
 *        checkLiquidatable(loanId) -> bool     (the condition, a pure view)
 *        liquidate(loanId)                     (the action)
 *      Evaluating both inside a single KeeperHub call closes the window in
 *      which a borrower repaying at the last second could still be liquidated
 *      on a stale read.
 */
contract PolarisLoanEngine is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Annualised interest, in basis points.
    uint256 public constant INTEREST_RATE_BPS = 1000; // 10%
    /// Share of interest kept by the protocol.
    uint256 public constant PROTOCOL_FEE_BPS = 2000; // 20%
    /// Default grace period when the deployer does not specify one.
    uint256 public constant DEFAULT_GRACE_PERIOD = 3 days;
    /// Upper bound, so a misconfigured deployment cannot make loans
    /// effectively un-liquidatable.
    uint256 public constant MAX_GRACE_PERIOD = 30 days;

    /**
     * @notice How long an installment may be overdue before the loan becomes
     *         liquidatable.
     * @dev Immutable per deployment rather than a global constant: a consumer
     *      book wants days, a machine-to-machine book wants minutes, and a
     *      testnet deployment wants seconds so the liquidation path can be
     *      demonstrated without waiting three days. Set once at construction
     *      so it can never be changed under a live loan.
     */
    uint256 public immutable gracePeriod;

    enum LoanStatus {
        Active,
        Repaid,
        Liquidated
    }

    struct Loan {
        address borrower;
        address merchant;
        uint128 principal;
        uint128 totalOwed;
        uint128 totalRepaid;
        uint32 installmentCount;
        uint32 installmentsPaid;
        uint64 startedAt;
        uint64 intervalSeconds;
        LoanStatus status;
    }

    IERC20 public immutable stablecoin;
    ScoreManager public immutable scoreManager;
    address public treasury;

    mapping(uint256 => Loan) public loans;
    mapping(address => uint256) public activeDebtOf;
    mapping(address => bool) public isOriginator;

    uint256 public loanCount;
    uint256 public protocolFeesAccrued;
    /// Unrecovered value from liquidations. The protocol's own loss ledger.
    uint256 public badDebt;

    /// Optional. When set, liquidation seizes collateral toward the shortfall.
    ICollateralSeize public collateralVault;
    /// Optional. When set, origination enforces merchant activation and caps.
    IMerchantChecks public merchantRegistry;

    event LoanCreated(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed merchant,
        uint256 principal,
        uint256 totalOwed,
        uint32 installments
    );
    event InstallmentPaid(
        uint256 indexed loanId,
        address indexed borrower,
        uint32 installmentIndex,
        uint256 amount,
        bool onTime
    );
    event LoanFullyRepaid(uint256 indexed loanId, address indexed borrower);
    event LoanLiquidated(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 outstanding,
        uint256 recovered
    );
    event LiquidityWithdrawn(address indexed to, uint256 amount);
    event CollateralVaultSet(address indexed vault);
    event MerchantRegistrySet(address indexed registry);
    event OriginatorSet(address indexed originator, bool allowed);
    event TreasuryChanged(address indexed treasury);

    error NotOriginator();
    error InvalidLoan();
    error LoanNotActive();
    error ZeroAmount();
    error InvalidInstallments();
    error NotLiquidatable();
    error ExceedsCreditLimit();
    error InvalidGracePeriod();
    error InsufficientAllowance(uint256 have, uint256 need);
    error InvalidInterval();
    error MerchantNotEligible();
    error ZeroAddress();
    error InsufficientLiquidity();

    modifier onlyOriginator() {
        if (!isOriginator[msg.sender]) revert NotOriginator();
        _;
    }

    constructor(
        address initialOwner,
        IERC20 _stablecoin,
        ScoreManager _scoreManager,
        address _treasury,
        uint256 _gracePeriod
    ) Ownable(initialOwner) {
        if (_gracePeriod > MAX_GRACE_PERIOD) revert InvalidGracePeriod();
        gracePeriod = _gracePeriod == 0 ? DEFAULT_GRACE_PERIOD : _gracePeriod;
        stablecoin = _stablecoin;
        scoreManager = _scoreManager;
        treasury = _treasury;
    }

    // -----------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------

    function setOriginator(address originator, bool allowed) external onlyOwner {
        isOriginator[originator] = allowed;
        emit OriginatorSet(originator, allowed);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasuryChanged(_treasury);
    }

    function setCollateralVault(ICollateralSeize vault) external onlyOwner {
        collateralVault = vault;
        emit CollateralVaultSet(address(vault));
    }

    function setMerchantRegistry(IMerchantChecks registry) external onlyOwner {
        merchantRegistry = registry;
        emit MerchantRegistrySet(address(registry));
    }

    /// @notice Seed protocol liquidity used to pay merchants up front.
    function fund(uint256 amount) external {
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Withdraw idle liquidity.
     * @dev `fund` was previously one-way: there was no path out at all, so
     *      seeded capital was locked in the contract forever. Accrued fees are
     *      excluded from what is withdrawable, so a withdrawal cannot strand
     *      the treasury's claim.
     */
    function withdrawLiquidity(uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = stablecoin.balanceOf(address(this));
        uint256 free = balance > protocolFeesAccrued ? balance - protocolFeesAccrued : 0;
        if (amount > free) revert InsufficientLiquidity();
        stablecoin.safeTransfer(to, amount);
        emit LiquidityWithdrawn(to, amount);
    }

    // -----------------------------------------------------------------
    // Origination
    // -----------------------------------------------------------------

    /**
     * @notice Open a BNPL plan and pay the merchant immediately.
     * @dev The borrower must already have approved this contract for
     *      `totalOwed`; that single approval is what every later installment
     *      is drawn against.
     */
    function createLoan(
        address borrower,
        address merchant,
        uint256 principal,
        uint32 installmentCount,
        uint64 intervalSeconds
    ) external onlyOriginator nonReentrant returns (uint256 loanId) {
        if (principal == 0) revert ZeroAmount();
        if (installmentCount == 0 || installmentCount > 24) revert InvalidInstallments();
        // An unvalidated interval let a caller pass 0, which made the loan
        // interest-free and due in full at origination -- liquidatable one
        // grace period later, with a schedule that never existed.
        if (intervalSeconds < 1 hours || intervalSeconds > 365 days) revert InvalidInterval();
        if (merchant == address(0) || borrower == address(0)) revert ZeroAddress();

        if (
            address(merchantRegistry) != address(0) &&
            !merchantRegistry.canOriginate(merchant, principal)
        ) {
            revert MerchantNotEligible();
        }

        uint256 term = uint256(installmentCount) * uint256(intervalSeconds);
        uint256 interest = (principal * INTEREST_RATE_BPS * term) / (10_000 * 365 days);
        uint256 totalOwed = principal + interest;

        if (activeDebtOf[borrower] + totalOwed > scoreManager.creditLimitOf(borrower)) {
            revert ExceedsCreditLimit();
        }

        // The whole collection model rests on a standing allowance. Paying the
        // merchant without one is a guaranteed total loss: every later repay
        // reverts and liquidation has nothing to pull.
        //
        // The comparison is against everything this borrower owes, not just the
        // loan being opened. A single allowance backs every open plan at once,
        // and nothing is drawn at origination -- so checking only `totalOwed`
        // let one approval sized for a single plan support as many loans as the
        // credit limit allowed. Settling the first legitimately exhausted the
        // allowance, `repay` on the rest then reverted, and `_recoverFromAllowance`
        // capped at an allowance of zero, so the full balance landed in badDebt
        // while the borrower still held the money. Exactly the total loss the
        // check above exists to prevent.
        uint256 required = activeDebtOf[borrower] + totalOwed;
        uint256 allowed = stablecoin.allowance(borrower, address(this));
        if (allowed < required) revert InsufficientAllowance(allowed, required);

        loanId = ++loanCount;
        loans[loanId] = Loan({
            borrower: borrower,
            merchant: merchant,
            principal: uint128(principal),
            totalOwed: uint128(totalOwed),
            totalRepaid: 0,
            installmentCount: installmentCount,
            installmentsPaid: 0,
            startedAt: uint64(block.timestamp),
            intervalSeconds: intervalSeconds,
            status: LoanStatus.Active
        });
        activeDebtOf[borrower] += totalOwed;

        // Merchant is paid now, in full. That is the product.
        stablecoin.safeTransfer(merchant, principal);

        emit LoanCreated(loanId, borrower, merchant, principal, totalOwed, installmentCount);
    }

    // -----------------------------------------------------------------
    // Collection -- what the keeper calls
    // -----------------------------------------------------------------

    /**
     * @notice Cumulative amount that must have been repaid for `k` installments
     *         to count as complete.
     * @dev Rounded up, and the schedule and the progress check both read from
     *      this one function. An earlier version computed the instalment amount
     *      by rounding down and inferred progress by rounding down again, so a
     *      full payment landed one unit short of its own threshold and counted
     *      as zero. One canonical ladder removes that class of bug entirely.
     */
    function thresholdFor(uint256 loanId, uint32 k) public view returns (uint256) {
        Loan storage l = loans[loanId];
        if (k == 0) return 0;
        if (k >= l.installmentCount) return uint256(l.totalOwed);
        uint256 num = uint256(l.totalOwed) * uint256(k);
        return (num + l.installmentCount - 1) / l.installmentCount;
    }

    /// @notice Amount due to complete the next unpaid installment.
    function installmentAmount(uint256 loanId) public view returns (uint256) {
        Loan storage l = loans[loanId];
        if (l.borrower == address(0)) revert InvalidLoan();
        if (l.installmentsPaid >= l.installmentCount) return 0;
        uint256 target = thresholdFor(loanId, l.installmentsPaid + 1);
        uint256 repaid = uint256(l.totalRepaid);
        return target > repaid ? target - repaid : 0;
    }

    /// @notice How many installments the money received actually covers.
    function installmentsEarned(uint256 loanId) public view returns (uint32) {
        Loan storage l = loans[loanId];
        uint32 k = 0;
        // Bounded by the 24-installment cap enforced at origination.
        while (k < l.installmentCount && uint256(l.totalRepaid) >= thresholdFor(loanId, k + 1)) {
            k++;
        }
        return k;
    }

    /// @notice When installment `index` (0-based) becomes collectable.
    function installmentDueAt(uint256 loanId, uint32 index) public view returns (uint256) {
        Loan storage l = loans[loanId];
        return uint256(l.startedAt) + (uint256(index) + 1) * uint256(l.intervalSeconds);
    }

    /// @notice True when the next installment is due now.
    function isInstallmentDue(uint256 loanId) public view returns (bool) {
        Loan storage l = loans[loanId];
        if (l.status != LoanStatus.Active) return false;
        return block.timestamp >= installmentDueAt(loanId, l.installmentsPaid);
    }

    /**
     * @notice Draw `amount` from the borrower against the loan.
     * @dev Permissionless by design -- see the contract-level note. Funds can
     *      only move from the borrower to this contract, so the worst a hostile
     *      caller can do is pay somebody's debt early.
     */
    function repay(uint256 loanId, uint256 amount) external nonReentrant {
        Loan storage l = loans[loanId];
        if (l.borrower == address(0)) revert InvalidLoan();
        if (l.status != LoanStatus.Active) revert LoanNotActive();
        if (amount == 0) revert ZeroAmount();
        if (l.installmentsPaid >= l.installmentCount) revert LoanNotActive();

        uint256 remaining = uint256(l.totalOwed) - uint256(l.totalRepaid);
        if (amount > remaining) amount = remaining;

        // Measure what the token actually delivered rather than trusting the
        // requested amount. A fee-on-transfer stablecoin -- USDC supports the
        // mechanism and merely has it disabled -- would otherwise over-credit
        // the borrower for money the contract never received.
        uint256 balanceBefore = stablecoin.balanceOf(address(this));
        stablecoin.safeTransferFrom(l.borrower, address(this), amount);
        amount = stablecoin.balanceOf(address(this)) - balanceBefore;
        if (amount == 0) revert ZeroAmount();

        bool onTime = block.timestamp <=
            installmentDueAt(loanId, l.installmentsPaid) + gracePeriod;

        l.totalRepaid += uint128(amount);
        activeDebtOf[l.borrower] -= amount;

        /*
         * Derive instalments-paid from money actually received, never by
         * incrementing per call.
         *
         * Incrementing was exploitable: a borrower could call repay() with one
         * base unit, four times, and the loan would show 4/4 collected while
         * ~200 was still owed -- and, because checkLiquidatable() returns false
         * once installmentsPaid reaches installmentCount, the loan would be
         * permanently un-liquidatable. Dust bought immunity.
         *
         * The proportion is exact for an equal schedule and monotonic in
         * totalRepaid, so a partial payment moves the borrower toward the next
         * instalment without ever completing one it did not cover.
         */
        // 0-based index of the instalment this payment goes toward, captured
        // before the counter moves. Using `installmentsPaid - 1` after the fact
        // underflows when a partial payment completes nothing.
        uint32 targetIndex = l.installmentsPaid;

        // Progress is read off the same canonical ladder the schedule is built
        // from, so a payment that meets its threshold always counts and one
        // that does not never does.
        uint32 earned = installmentsEarned(loanId);
        bool completedOne = earned > l.installmentsPaid;
        l.installmentsPaid = earned;

        /*
         * Accrue the protocol's share of *actual* interest, proportionally.
         *
         * The previous formula treated 10% of every repayment as interest and
         * took 20% of that -- roughly 2% of the whole loan. Real interest is
         * annualised and pro-rated over the term, so on any plan shorter than
         * about 75 days the fee exceeded every penny of interest earned and the
         * difference came out of merchant-payout liquidity. A 200 loan over 40
         * days repaid perfectly on time still lost the pool money.
         */
        uint256 totalInterest = uint256(l.totalOwed) - uint256(l.principal);
        if (totalInterest > 0) {
            uint256 feeOnThisPayment =
                (amount * totalInterest * PROTOCOL_FEE_BPS) / (uint256(l.totalOwed) * 10_000);
            if (feeOnThisPayment > 0) {
                protocolFeesAccrued += feeOnThisPayment;
            }
        }

        // Index is 0-based to match installmentDueAt, so an indexer can join
        // the event to the schedule without an off-by-one.
        emit InstallmentPaid(loanId, l.borrower, targetIndex, amount, onTime);

        // Score only moves when an instalment actually completed. A partial
        // payment is progress, not a payment event, and scoring it would let a
        // borrower farm their score with dust.
        if (completedOne) {
            if (onTime) {
                scoreManager.recordOnTimePayment(l.borrower);
            } else {
                scoreManager.recordLatePayment(l.borrower);
            }
        }

        if (l.totalRepaid >= l.totalOwed) {
            l.status = LoanStatus.Repaid;
            emit LoanFullyRepaid(loanId, l.borrower);
        }
    }

    // -----------------------------------------------------------------
    // Liquidation -- the check-and-execute pair
    // -----------------------------------------------------------------

    /**
     * @notice The condition half of the keeper's check-and-execute.
     * @dev A pure view returning a plain bool, so KeeperHub can evaluate it as
     *      a condition and branch on it without interpreting protocol types.
     */
    function checkLiquidatable(uint256 loanId) public view returns (bool) {
        Loan storage l = loans[loanId];
        if (l.borrower == address(0)) return false;
        if (l.status != LoanStatus.Active) return false;
        if (l.installmentsPaid >= l.installmentCount) return false;
        return block.timestamp > installmentDueAt(loanId, l.installmentsPaid) + gracePeriod;
    }

    /**
     * @notice The action half. Reverts unless the condition genuinely holds.
     *
     * @dev This used to move zero tokens. It marked the loan liquidated, freed
     *      `activeDebtOf`, dinged the score and stopped -- which made it
     *      *profitable* for the defaulter, who could call it on themselves to
     *      have the debt written off and their credit line released, then
     *      borrow again against the 200-unit score floor. That loop was
     *      infinite and cost the pool the full principal every round.
     *
     *      Now it recovers what it can, in order:
     *        1. whatever the borrower's standing allowance still permits
     *        2. seized collateral, if a vault is configured
     *      and books the unrecovered remainder as bad debt so the protocol has
     *      an on-chain measure of its own losses.
     */
    function liquidate(uint256 loanId) external nonReentrant {
        if (!checkLiquidatable(loanId)) revert NotLiquidatable();

        Loan storage l = loans[loanId];
        uint256 outstanding = uint256(l.totalOwed) - uint256(l.totalRepaid);

        l.status = LoanStatus.Liquidated;
        activeDebtOf[l.borrower] -= outstanding;

        uint256 recovered = _recoverFromAllowance(l.borrower, outstanding);

        if (address(collateralVault) != address(0) && recovered < outstanding) {
            recovered += collateralVault.seize(
                l.borrower,
                outstanding - recovered,
                address(this)
            );
        }

        l.totalRepaid += uint128(recovered);
        if (recovered < outstanding) {
            badDebt += outstanding - recovered;
        }

        scoreManager.recordLiquidation(l.borrower);
        emit LoanLiquidated(loanId, l.borrower, outstanding, recovered);
    }

    /// Pull whatever the borrower's remaining allowance and balance permit.
    function _recoverFromAllowance(address borrower, uint256 want)
        private
        returns (uint256)
    {
        uint256 allowed = stablecoin.allowance(borrower, address(this));
        uint256 held = stablecoin.balanceOf(borrower);
        uint256 take = want;
        if (take > allowed) take = allowed;
        if (take > held) take = held;
        if (take == 0) return 0;

        uint256 before = stablecoin.balanceOf(address(this));
        stablecoin.safeTransferFrom(borrower, address(this), take);
        return stablecoin.balanceOf(address(this)) - before;
    }

    // -----------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    function outstandingOf(uint256 loanId) external view returns (uint256) {
        Loan storage l = loans[loanId];
        return uint256(l.totalOwed) - uint256(l.totalRepaid);
    }

    function sweepFees() external onlyOwner {
        if (treasury == address(0)) revert ZeroAddress();
        uint256 amount = protocolFeesAccrued;
        protocolFeesAccrued = 0;
        if (amount > 0) {
            stablecoin.safeTransfer(treasury, amount);
        }
    }
}
