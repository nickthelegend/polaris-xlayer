// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {StockPriceOracle} from "./StockPriceOracle.sol";
import {LiquidityPool} from "./LiquidityPool.sol";

/**
 * @title StocklineEngine
 * @notice Spend the stock. Don't sell the stock.
 *
 * @dev A shopper holding tokenized equity checks out at a merchant who only
 *      takes stablecoin. Rather than selling the shares, they lock them here
 *      and the merchant is paid immediately out of the pool. The shopper keeps
 *      the upside, repays inside the tenor, and takes the shares back.
 *
 *      Three decisions shape everything below.
 *
 *      **The merchant is never at risk.** They are paid in full, on the spot,
 *      from stablecoin the pool already held. If the borrower defaults the
 *      pool eats it, not the merchant. That is why `openLoan` draws from the
 *      pool before it does anything else that can fail.
 *
 *      **Collateral is custodied here and accounted per loan.** There is no
 *      shared collateral balance a second loan could borrow against, and no
 *      rehypothecation: `lockedOf` is the sum of live positions and the engine
 *      never moves a share that is not being released or liquidated. A
 *      separate vault contract was considered and rejected — it would add a
 *      cross-contract call on every state change for no gain in safety.
 *
 *      **Liquidation sells only what is needed.** A liquidator repays the debt
 *      and receives collateral worth the debt plus a bonus; everything left
 *      over goes back to the borrower in the same transaction. The borrower
 *      losing their whole position over a small shortfall is the failure mode
 *      this product exists to avoid, so it is prevented in code rather than
 *      promised in copy.
 */
contract StocklineEngine is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Active,
        Repaid,
        Liquidated
    }

    struct Loan {
        address borrower;
        address merchant;
        address stock;
        uint256 shares; // collateral, in stock token units
        uint256 principal; // stablecoin paid to the merchant
        uint256 fee; // origination + interest, fixed at open
        uint64 openedAt;
        uint64 dueAt;
        uint256 openPrice; // the print the loan was written against, 1e8
        bool openedWhileClosed; // was the venue shut when this was written
        Status status;
    }

    uint256 public constant BPS = 10_000;
    uint8 private constant ORACLE_DECIMALS = 8;

    IERC20 public immutable stable; // USDT0
    uint8 public immutable stableDecimals;
    StockPriceOracle public oracle;
    LiquidityPool public pool;

    /// Stock tokens accepted as collateral. Nothing else can be locked.
    mapping(address => bool) public isAcceptedStock;

    /// Ceiling on what can be borrowed against a share, before haircuts. 35%.
    uint256 public maxLtvBps = 3_500;
    /// Extra haircut applied when the venue was shut at open. Weekend gap risk.
    uint256 public closedMarketHaircutBps = 1_000;
    /// Debt above this share of collateral value is liquidatable. 50%.
    uint256 public liquidationThresholdBps = 5_000;
    /// Paid to whoever clears a bad position, out of the borrower's collateral.
    uint256 public liquidationBonusBps = 500;
    /// Charged once, at open.
    uint256 public originationFeeBps = 100;
    /// Simple interest on the float, per year, charged up front for the tenor.
    uint256 public interestAprBps = 1_200;

    uint64 public minTenor = 7 days;
    uint64 public maxTenor = 14 days;

    Loan[] private _loans;
    mapping(address => uint256[]) private _loansOf;
    mapping(address => uint256) public lockedOf; // stock => total shares held
    /// keccak(merchant, orderRef) => loanId+1. Makes a retried checkout idempotent.
    mapping(bytes32 => uint256) private _orderToLoan;

    event StockAccepted(address indexed stock, bool accepted);
    event LoanOpened(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed merchant,
        address stock,
        uint256 shares,
        uint256 principal,
        uint256 fee,
        uint64 dueAt,
        uint256 openPrice,
        bytes32 orderRef
    );
    event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 sharesReturned);
    event LoanLiquidated(
        uint256 indexed loanId,
        address indexed liquidator,
        uint256 debtPaid,
        uint256 sharesSeized,
        uint256 sharesReturned,
        uint256 price
    );
    event ParamsChanged(string what, uint256 value);

    error StockNotAccepted(address stock);
    error ZeroAmount();
    error TenorOutOfRange(uint64 tenor);
    error ExceedsMaxLtv(uint256 requested, uint256 allowed);
    error NotActive(uint256 loanId);
    error NotBorrower();
    error NotLiquidatable(uint256 loanId, uint256 healthFactorWad);
    error OrderAlreadyUsed(bytes32 key, uint256 loanId);
    error BadParam();

    constructor(IERC20 stable_, StockPriceOracle oracle_, LiquidityPool pool_, address owner_) Ownable(owner_) {
        stable = stable_;
        stableDecimals = IERC20Metadata(address(stable_)).decimals();
        oracle = oracle_;
        pool = pool_;
    }

    // ── admin ───────────────────────────────────────────────────────────────

    function setAcceptedStock(address stock, bool accepted) external onlyOwner {
        isAcceptedStock[stock] = accepted;
        emit StockAccepted(stock, accepted);
    }

    function setRiskParams(
        uint256 maxLtvBps_,
        uint256 closedMarketHaircutBps_,
        uint256 liquidationThresholdBps_,
        uint256 liquidationBonusBps_
    ) external onlyOwner {
        // The threshold must sit above the ceiling or a loan is liquidatable
        // the instant it opens.
        if (maxLtvBps_ == 0 || maxLtvBps_ >= liquidationThresholdBps_) revert BadParam();
        if (liquidationThresholdBps_ > BPS) revert BadParam();
        if (closedMarketHaircutBps_ >= BPS) revert BadParam();
        if (liquidationBonusBps_ > 2_000) revert BadParam();
        maxLtvBps = maxLtvBps_;
        closedMarketHaircutBps = closedMarketHaircutBps_;
        liquidationThresholdBps = liquidationThresholdBps_;
        liquidationBonusBps = liquidationBonusBps_;
        emit ParamsChanged("risk", maxLtvBps_);
    }

    function setFees(uint256 originationFeeBps_, uint256 interestAprBps_) external onlyOwner {
        if (originationFeeBps_ > 500 || interestAprBps_ > 5_000) revert BadParam();
        originationFeeBps = originationFeeBps_;
        interestAprBps = interestAprBps_;
        emit ParamsChanged("fees", originationFeeBps_);
    }

    function setOracle(StockPriceOracle oracle_) external onlyOwner {
        oracle = oracle_;
    }

    // ── pricing ─────────────────────────────────────────────────────────────

    /**
     * @notice What `shares` of `stock` are worth, in stablecoin units.
     * @dev Not named `valueOf`: that collides with `Object.prototype.valueOf`
     *      in JavaScript, so `engine.valueOf(...)` in ethers.js silently
     *      returns the contract object instead of calling the contract, and
     *      the caller gets no error at all.
     * @dev Decimals are converted explicitly rather than assumed equal. The
     *      stock token, the oracle (1e8) and the stablecoin (usually 1e6) all
     *      use different scales, and conflating any two of them silently
     *      misprices the book by orders of magnitude.
     */
    function collateralValueOf(address stock, uint256 shares, uint256 usdPerShare) public view returns (uint256) {
        uint8 sd = IERC20Metadata(stock).decimals();
        return (shares * usdPerShare * (10 ** stableDecimals)) / (10 ** sd) / (10 ** ORACLE_DECIMALS);
    }

    /// @notice The effective ceiling, after the after-hours haircut.
    function effectiveLtvBps(bool marketOpen) public view returns (uint256) {
        if (marketOpen) return maxLtvBps;
        return (maxLtvBps * (BPS - closedMarketHaircutBps)) / BPS;
    }

    /**
     * @notice Everything a checkout needs to show before the shopper commits.
     * @dev Quoted before anything is locked, so the number on the merchant's
     *      screen is the number the contract will enforce.
     */
    function quote(address stock, uint256 shares, uint64 tenor)
        public
        view
        returns (
            uint256 collateralValue,
            uint256 maxBorrow,
            uint256 ltvBps,
            uint256 feeOnMax,
            uint256 usdPerShare,
            bool marketOpen
        )
    {
        uint64 printedAt;
        (usdPerShare, printedAt, marketOpen) = oracle.getPrice(stock);
        printedAt; // the receipt carries it; unused here
        collateralValue = collateralValueOf(stock, shares, usdPerShare);
        ltvBps = effectiveLtvBps(marketOpen);
        maxBorrow = (collateralValue * ltvBps) / BPS;
        feeOnMax = feeFor(maxBorrow, tenor);
    }

    /// @notice Origination plus simple interest for the tenor, charged at open.
    function feeFor(uint256 principal, uint64 tenor) public view returns (uint256) {
        uint256 origination = (principal * originationFeeBps) / BPS;
        uint256 interest = (principal * interestAprBps * tenor) / (BPS * 365 days);
        return origination + interest;
    }

    // ── the product ─────────────────────────────────────────────────────────

    /**
     * @notice Lock shares, pay the merchant, open the loan.
     * @param orderRef the merchant's own reference for this checkout. Together
     *        with the merchant address it makes a retry idempotent — a shopper
     *        double-tapping cannot open two loans for one basket.
     */
    function openLoan(
        address stock,
        uint256 shares,
        address merchant,
        bytes32 orderRef,
        uint256 borrowAmount,
        uint64 tenor
    ) external nonReentrant returns (uint256 loanId) {
        if (!isAcceptedStock[stock]) revert StockNotAccepted(stock);
        if (shares == 0 || borrowAmount == 0) revert ZeroAmount();
        if (tenor < minTenor || tenor > maxTenor) revert TenorOutOfRange(tenor);

        bytes32 key = keccak256(abi.encodePacked(merchant, orderRef));
        uint256 existing = _orderToLoan[key];
        if (existing != 0) revert OrderAlreadyUsed(key, existing - 1);

        (uint256 usdPerShare,, bool marketOpen) = oracle.getPrice(stock);
        uint256 collateralValue = collateralValueOf(stock, shares, usdPerShare);
        uint256 allowed = (collateralValue * effectiveLtvBps(marketOpen)) / BPS;
        if (borrowAmount > allowed) revert ExceedsMaxLtv(borrowAmount, allowed);

        uint256 fee = feeFor(borrowAmount, tenor);

        loanId = _loans.length;
        _loans.push(
            Loan({
                borrower: msg.sender,
                merchant: merchant,
                stock: stock,
                shares: shares,
                principal: borrowAmount,
                fee: fee,
                openedAt: uint64(block.timestamp),
                dueAt: uint64(block.timestamp) + tenor,
                openPrice: usdPerShare,
                openedWhileClosed: !marketOpen,
                status: Status.Active
            })
        );
        _loansOf[msg.sender].push(loanId);
        _orderToLoan[key] = loanId + 1;
        lockedOf[stock] += shares;

        // Collateral in before money out. If the shopper cannot deliver the
        // shares the merchant is never paid.
        IERC20(stock).safeTransferFrom(msg.sender, address(this), shares);
        pool.draw(merchant, borrowAmount);

        emit LoanOpened(
            loanId, msg.sender, merchant, stock, shares, borrowAmount, fee, uint64(block.timestamp) + tenor, usdPerShare, orderRef
        );
    }

    /// @notice Pay it back, take the shares.
    function repay(uint256 loanId) external nonReentrant {
        Loan storage l = _loans[loanId];
        if (l.status != Status.Active) revert NotActive(loanId);
        if (msg.sender != l.borrower) revert NotBorrower();

        uint256 owed = l.principal + l.fee;
        l.status = Status.Repaid;
        lockedOf[l.stock] -= l.shares;

        stable.safeTransferFrom(msg.sender, address(pool), owed);
        pool.onRepaid(l.principal, l.fee);
        IERC20(l.stock).safeTransfer(l.borrower, l.shares);

        emit LoanRepaid(loanId, l.borrower, owed, l.shares);
    }

    /**
     * @notice How much cover is left. 1e18 == exactly at the threshold.
     * @dev Below 1e18 the position is liquidatable. Past the due date it is
     *      liquidatable regardless — see `isLiquidatable`.
     */
    function healthFactor(uint256 loanId) public view returns (uint256) {
        Loan memory l = _loans[loanId];
        if (l.status != Status.Active) return type(uint256).max;
        (uint256 usdPerShare,,) = oracle.getPrice(l.stock);
        uint256 value = collateralValueOf(l.stock, l.shares, usdPerShare);
        uint256 debt = l.principal + l.fee;
        if (debt == 0) return type(uint256).max;
        return (value * liquidationThresholdBps * 1e18) / (BPS * debt);
    }

    function isLiquidatable(uint256 loanId) public view returns (bool) {
        Loan memory l = _loans[loanId];
        if (l.status != Status.Active) return false;
        if (block.timestamp > l.dueAt) return true;
        return healthFactor(loanId) < 1e18;
    }

    /**
     * @notice Clear a bad position: pay the debt, take only the shares that
     *         cover it plus the bonus, and hand the rest back to the borrower.
     * @dev The remainder returning to the borrower in this same transaction is
     *      the point. If collateral no longer covers the debt the liquidator
     *      takes all of it and the pool wears the shortfall — the borrower is
     *      never left owing more than the shares they put up.
     */
    function liquidate(uint256 loanId) external nonReentrant {
        Loan storage l = _loans[loanId];
        if (l.status != Status.Active) revert NotActive(loanId);
        if (!isLiquidatable(loanId)) revert NotLiquidatable(loanId, healthFactor(loanId));

        (uint256 usdPerShare,,) = oracle.getPrice(l.stock);
        uint256 debt = l.principal + l.fee;

        // Shares whose value equals the debt plus the liquidator's bonus.
        uint256 seizeValue = (debt * (BPS + liquidationBonusBps)) / BPS;
        uint8 sd = IERC20Metadata(l.stock).decimals();
        uint256 seizeShares =
            (seizeValue * (10 ** sd) * (10 ** ORACLE_DECIMALS)) / (usdPerShare * (10 ** stableDecimals));
        uint256 returnShares;
        if (seizeShares >= l.shares) {
            seizeShares = l.shares; // underwater: the collateral is all there is
        } else {
            returnShares = l.shares - seizeShares;
        }

        l.status = Status.Liquidated;
        lockedOf[l.stock] -= l.shares;

        stable.safeTransferFrom(msg.sender, address(pool), debt);
        pool.onRepaid(l.principal, l.fee);
        IERC20(l.stock).safeTransfer(msg.sender, seizeShares);
        if (returnShares > 0) IERC20(l.stock).safeTransfer(l.borrower, returnShares);

        emit LoanLiquidated(loanId, msg.sender, debt, seizeShares, returnShares, usdPerShare);
    }

    // ── reads ───────────────────────────────────────────────────────────────

    function loanCount() external view returns (uint256) {
        return _loans.length;
    }

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return _loans[loanId];
    }

    function loansOf(address user) external view returns (uint256[] memory) {
        return _loansOf[user];
    }

    function loanIdForOrder(address merchant, bytes32 orderRef) external view returns (bool found, uint256 loanId) {
        uint256 v = _orderToLoan[keccak256(abi.encodePacked(merchant, orderRef))];
        return v == 0 ? (false, 0) : (true, v - 1);
    }

    function amountOwed(uint256 loanId) external view returns (uint256) {
        Loan memory l = _loans[loanId];
        if (l.status != Status.Active) return 0;
        return l.principal + l.fee;
    }
}
