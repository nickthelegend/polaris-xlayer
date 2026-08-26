// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CollateralVault
 * @notice Optional collateral that raises a borrower's credit limit.
 *
 * @dev Polaris is a credit-score protocol first: a borrower with no collateral
 *      still gets a limit from their repayment history. Collateral is the lever
 *      for someone who has no history yet, or who wants more than their score
 *      allows.
 *
 *      The rule is deliberately simple and legible to a borrower: locked
 *      collateral adds its face value times a multiplier to the limit. At the
 *      default 150% a borrower locking 100 USDC gains 150 USDC of headroom,
 *      which is still undercollateralized overall and preserves the point of
 *      the product.
 *
 *      Withdrawal is blocked while a loan is outstanding. That is enforced by
 *      asking the LoanEngine for live debt rather than mirroring it here --
 *      two copies of the same number is how a vault ends up releasing
 *      collateral that is still securing a loan.
 */
interface ILoanEngineDebt {
    function activeDebtOf(address user) external view returns (uint256);
}

contract CollateralVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Basis points of credit granted per unit of collateral. 15000 = 150%.
    uint256 public creditMultiplierBps = 15_000;
    uint256 public constant MAX_MULTIPLIER_BPS = 30_000;

    IERC20 public immutable collateralToken;
    ILoanEngineDebt public loanEngine;

    mapping(address => uint256) public lockedOf;
    /// Set when a liquidation seizes collateral, so it cannot be double-seized.
    mapping(address => uint256) public seizedOf;
    uint256 public totalLocked;

    /// Contracts allowed to seize on default. The LoanEngine, in practice.
    mapping(address => bool) public isSeizer;

    event CollateralLocked(address indexed user, uint256 amount, uint256 newTotal);
    event CollateralWithdrawn(address indexed user, uint256 amount, uint256 newTotal);
    event CollateralSeized(address indexed user, uint256 amount, address indexed to);
    event SeizerSet(address indexed seizer, bool allowed);
    event MultiplierChanged(uint256 bps);
    event LoanEngineSet(address indexed engine);

    error ZeroAmount();
    error InsufficientCollateral();
    error DebtOutstanding(uint256 debt);
    error NotSeizer();
    error InvalidMultiplier();

    constructor(address initialOwner, IERC20 _collateralToken) Ownable(initialOwner) {
        collateralToken = _collateralToken;
    }

    // -----------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------

    function setLoanEngine(ILoanEngineDebt engine) external onlyOwner {
        loanEngine = engine;
        emit LoanEngineSet(address(engine));
    }

    function setSeizer(address seizer, bool allowed) external onlyOwner {
        isSeizer[seizer] = allowed;
        emit SeizerSet(seizer, allowed);
    }

    function setCreditMultiplierBps(uint256 bps) external onlyOwner {
        if (bps == 0 || bps > MAX_MULTIPLIER_BPS) revert InvalidMultiplier();
        creditMultiplierBps = bps;
        emit MultiplierChanged(bps);
    }

    // -----------------------------------------------------------------
    // Borrower
    // -----------------------------------------------------------------

    /// @notice Lock collateral to raise your credit limit.
    function lock(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        lockedOf[msg.sender] += amount;
        totalLocked += amount;
        emit CollateralLocked(msg.sender, amount, lockedOf[msg.sender]);
    }

    /**
     * @notice Withdraw collateral. Blocked while any debt is outstanding.
     * @dev Debt is read live from the LoanEngine. An all-or-nothing block
     *      rather than a partial release: releasing "the unused portion" needs
     *      a solvency calculation that is wrong the moment the borrower's score
     *      changes, and a borrower who wants their collateral back can repay.
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (lockedOf[msg.sender] < amount) revert InsufficientCollateral();

        if (address(loanEngine) != address(0)) {
            uint256 debt = loanEngine.activeDebtOf(msg.sender);
            if (debt > 0) revert DebtOutstanding(debt);
        }

        lockedOf[msg.sender] -= amount;
        totalLocked -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount, lockedOf[msg.sender]);
    }

    // -----------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------

    /// @notice Extra credit this borrower's collateral is worth, in base units.
    function creditBoostOf(address user) external view returns (uint256) {
        return (lockedOf[user] * creditMultiplierBps) / 10_000;
    }

    /// @notice Whether the borrower can currently withdraw anything.
    function withdrawable(address user) external view returns (uint256) {
        if (address(loanEngine) != address(0) && loanEngine.activeDebtOf(user) > 0) {
            return 0;
        }
        return lockedOf[user];
    }

    // -----------------------------------------------------------------
    // Seizure
    // -----------------------------------------------------------------

    /**
     * @notice Seize collateral on default. Callable only by a registered seizer.
     * @dev Capped at what the borrower actually has, so a shortfall is a
     *      partial recovery rather than a revert that would block the
     *      liquidation entirely. Returns what was actually taken.
     */
    function seize(address user, uint256 amount, address to)
        external
        nonReentrant
        returns (uint256 taken)
    {
        if (!isSeizer[msg.sender]) revert NotSeizer();

        taken = amount > lockedOf[user] ? lockedOf[user] : amount;
        if (taken == 0) {
            return 0;
        }

        lockedOf[user] -= taken;
        totalLocked -= taken;
        seizedOf[user] += taken;
        collateralToken.safeTransfer(to, taken);
        emit CollateralSeized(user, taken, to);
    }
}
