// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LiquidityPool
 * @notice The warehouse the merchant is paid out of.
 *
 * @dev The merchant is paid immediately, in full, out of stablecoin that is
 *      already here. They are never paid from the proceeds of a future
 *      liquidation, and they carry none of the borrower's risk — that is the
 *      whole promise of the product and it is enforced by this contract
 *      holding the money before the loan opens rather than after.
 *
 *      Only the engine may draw. `available()` is what is actually drawable,
 *      so a checkout can be refused before a borrower locks collateral rather
 *      than reverting halfway through and leaving shares stuck.
 */
contract LiquidityPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;

    /// The engine. The only address allowed to move money out.
    address public engine;

    /// Principal currently out on loan. Grows on draw, shrinks on repay.
    uint256 public outstanding;
    /// Interest and origination fees the pool has earned, all-time.
    uint256 public earned;

    event EngineSet(address indexed engine);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Drawn(address indexed to, uint256 amount, uint256 outstanding);
    event Repaid(address indexed from, uint256 principal, uint256 fees, uint256 outstanding);

    error NotEngine();
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error ZeroAmount();

    constructor(IERC20 asset_, address owner_) Ownable(owner_) {
        asset = asset_;
    }

    modifier onlyEngine() {
        if (msg.sender != engine) revert NotEngine();
        _;
    }

    function setEngine(address engine_) external onlyOwner {
        engine = engine_;
        emit EngineSet(engine_);
    }

    /// @notice Stablecoin sitting here and not already lent out.
    function available() public view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /**
     * @dev Withdrawal is capped at what is not lent out. The owner cannot pull
     *      the float out from under loans that are already open.
     */
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        uint256 free = available();
        if (amount > free) revert InsufficientLiquidity(amount, free);
        asset.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Pay a merchant. Called by the engine while opening a loan.
    function draw(address to, uint256 amount) external onlyEngine nonReentrant {
        uint256 free = available();
        if (amount > free) revert InsufficientLiquidity(amount, free);
        outstanding += amount;
        asset.safeTransfer(to, amount);
        emit Drawn(to, amount, outstanding);
    }

    /**
     * @notice Book a repayment. The tokens are moved by the engine.
     * @dev Only the accounting lives here. `principal` is capped at
     *      `outstanding` so a rounding artefact or a double-book cannot
     *      underflow the pool's idea of what is still lent out.
     */
    function onRepaid(uint256 principal, uint256 fees) external onlyEngine {
        uint256 p = principal > outstanding ? outstanding : principal;
        outstanding -= p;
        earned += fees;
        emit Repaid(msg.sender, p, fees, outstanding);
    }
}
