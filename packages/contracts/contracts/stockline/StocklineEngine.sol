// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {StockPriceOracle} from "./StockPriceOracle.sol";
import {LiquidityPool} from "./LiquidityPool.sol";

/// Chainlink's L2 Sequencer Uptime feed. answer: 0 = up, 1 = down.
interface IL2SequencerUptime {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

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

    /**
     * Chainlink's L2 Sequencer Uptime feed, and how long after it comes back
     * before liquidation is allowed again.
     *
     * @dev X Layer is an OP Stack L2 with a single sequencer. If it stalls, a
     *      borrower physically cannot get a repayment transaction on chain
     *      while the price keeps moving underneath them — and the moment it
     *      resumes, every position that drifted is liquidatable at once,
     *      through no fault of the borrower. Blocking liquidation during the
     *      outage and for a grace period after it is what gives them their
     *      window back.
     *
     *      Repayment is deliberately NOT gated on this. A borrower who can
     *      reach the chain should always be able to get out.
     *
     *      Unset (address(0)) disables the check, which is the correct state
     *      on a network that publishes no such feed — X Layer testnet has
     *      none. Mainnet's lives at 0x45c2b8C204568A03Dc7A2E32B71D67Fe97F908A9.
     */
    IL2SequencerUptime public sequencerUptimeFeed;
    uint64 public sequencerGracePeriod = 1 hours;

    Loan[] private _loans;
    mapping(address => uint256[]) private _loansOf;
    mapping(address => uint256) public lockedOf; // stock => total shares held
    /// keccak(merchant, orderRef, borrower) => loanId+1. Retry idempotency.
    mapping(bytes32 => uint256) private _orderToLoan;

    /**
     * Shares owed to someone that could not be delivered.
     *
     * @dev Real tokenized equity carries an issuer blocklist — that is what
     *      makes it a regulated instrument rather than a token. If the
     *      borrower's address is blocked, pushing their collateral back
     *      reverts, and with it the whole transaction: `repay` fails, and so
     *      does `liquidate`, because it hands the remainder back in the same
     *      call. The position sticks on Active forever, `outstanding` never
     *      clears, and the collateral is bricked in this contract with no way
     *      out.
     *
     *      So delivery is attempted, and if the token refuses the recipient
     *      the shares are credited here instead. Settlement always completes;
     *      only the delivery waits. The borrower pulls with `claim` once they
     *      can receive again.
     */
    mapping(address => mapping(address => uint256)) public claimable;

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
    event DeliveryDeferred(address indexed to, address indexed token, uint256 amount);
    event Claimed(address indexed to, address indexed token, uint256 amount);

    error StockNotAccepted(address stock);
    error ZeroAmount();
    error TenorOutOfRange(uint64 tenor);
    error ExceedsMaxLtv(uint256 requested, uint256 allowed);
    error NotActive(uint256 loanId);
    error NotBorrower();
    error NotLiquidatable(uint256 loanId, uint256 healthFactorWad);
    error OrderAlreadyUsed(bytes32 key, uint256 loanId);
    error BadParam();
    error CollateralShortfall(uint256 expected, uint256 received);
    error MarketShut();

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

    function setSequencerUptimeFeed(IL2SequencerUptime feed, uint64 grace) external onlyOwner {
        if (grace > 12 hours) revert BadParam();
        sequencerUptimeFeed = feed;
        sequencerGracePeriod = grace;
        emit ParamsChanged("sequencer", grace);
    }

    /**
     * @notice Is the chain healthy enough to liquidate against?
     * @dev False while the sequencer is down and for `sequencerGracePeriod`
     *      after it returns. True when no feed is configured, because a
     *      network with no uptime feed gives us nothing to check.
     */
    function sequencerOk() public view returns (bool) {
        if (address(sequencerUptimeFeed) == address(0)) return true;
        (, int256 answer, uint256 startedAt,,) = sequencerUptimeFeed.latestRoundData();
        if (answer != 0) return false; // down right now
        // startedAt is when the *current* status began. If it only just came
        // back up, borrowers have not had their window yet.
        return block.timestamp - startedAt > sequencerGracePeriod;
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
        uint256 allowed = (collateralValue * ltvBps) / BPS;

        // The ceiling covers principal *and* the prepaid fee, so the largest
        // borrowable principal is not the ceiling itself — it is the ceiling
        // net of the fee that borrowing it would incur. Solve
        //     borrow + borrow * k / BPS <= allowed
        // for borrow, where k is the fee in bps over this tenor.
        uint256 k = originationFeeBps + (interestAprBps * tenor) / (365 days);
        maxBorrow = (allowed * BPS) / (BPS + k);
        feeOnMax = feeFor(maxBorrow, tenor);
        // Integer division can leave the pair a hair over; walk it back so the
        // number quoted is always one the contract will actually accept.
        while (maxBorrow > 0 && maxBorrow + feeOnMax > allowed) {
            maxBorrow -= 1;
            feeOnMax = feeFor(maxBorrow, tenor);
        }
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

        // Keyed on the borrower too. On (merchant, orderRef) alone, anyone
        // could open a dust loan against a merchant's published reference and
        // permanently burn it, so the real shopper's checkout reverts.
        bytes32 key = keccak256(abi.encode(merchant, orderRef, msg.sender));
        uint256 existing = _orderToLoan[key];
        if (existing != 0) revert OrderAlreadyUsed(key, existing - 1);

        (uint256 usdPerShare,, bool marketOpen) = oracle.getPrice(stock);
        uint256 collateralValue = collateralValueOf(stock, shares, usdPerShare);
        uint256 allowed = (collateralValue * effectiveLtvBps(marketOpen)) / BPS;
        uint256 fee = feeFor(borrowAmount, tenor);
        // The fee is charged at open and is owed from the first block, so it
        // is debt and belongs inside the ceiling. Checking only the principal
        // let a "35%" loan open at 35.51% of collateral.
        if (borrowAmount + fee > allowed) revert ExceedsMaxLtv(borrowAmount + fee, allowed);

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
        //
        // Book what arrived, not what was asked for: a fee-on-transfer or
        // rebasing token would otherwise have the engine lending against
        // collateral it never received.
        uint256 before = IERC20(stock).balanceOf(address(this));
        IERC20(stock).safeTransferFrom(msg.sender, address(this), shares);
        uint256 received = IERC20(stock).balanceOf(address(this)) - before;
        if (received != shares) revert CollateralShortfall(shares, received);

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
        _deliver(l.stock, l.borrower, l.shares);

        emit LoanRepaid(loanId, l.borrower, owed, l.shares);
    }

    /**
     * @notice How much cover is left. 1e18 == exactly at the threshold.
     * @dev Below 1e18 the position is liquidatable. Past the due date it is
     *      liquidatable regardless — see `isLiquidatable`.
     *
     *      This does not revert on a missing or stale price; it reports the
     *      position as unassessable by returning max. An earlier version
     *      called `oracle.getPrice` and reverted, which made both this and
     *      `isLiquidatable` untotal views — and the state where that bites is
     *      exactly the one after a sequencer outage, when the price is always
     *      stale and a keeper most needs a straight answer.
     */
    function healthFactor(uint256 loanId) public view returns (uint256) {
        Loan memory l = _loans[loanId];
        if (l.status != Status.Active) return type(uint256).max;
        (uint256 usdPerShare,,, bool fresh) = oracle.peek(l.stock);
        if (!fresh) return type(uint256).max;
        uint256 value = collateralValueOf(l.stock, l.shares, usdPerShare);
        uint256 debt = l.principal + l.fee;
        if (debt == 0) return type(uint256).max;
        return (value * liquidationThresholdBps * 1e18) / (BPS * debt);
    }

    function isLiquidatable(uint256 loanId) public view returns (bool) {
        Loan memory l = _loans[loanId];
        if (l.status != Status.Active) return false;
        // Nothing is liquidatable while the borrower could not have reached
        // the chain to prevent it.
        if (!sequencerOk()) return false;
        // Nor on a price we would not lend against. `liquidate` demands a
        // fresh print anyway; saying so here keeps the view honest instead of
        // promising a call that is going to revert.
        (, uint64 printedAt, bool marketOpen, bool fresh) = oracle.peek(l.stock);
        if (!fresh) return false;
        // Agree with liquidate(), which will not seize while the venue is shut.
        if (!marketOpen || uint64(block.timestamp) - printedAt > oracle.maxAge()) return false;
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

        (uint256 usdPerShare, uint64 printedAt, bool marketOpen) = oracle.getPrice(l.stock);
        // Opening a position against a four-day-old closing print is fine —
        // it is haircut for. Seizing someone's shares against one is not: the
        // venue is shut, the collateral cannot actually be sold, and the
        // price the seizure is computed at is days from the truth. Liquidation
        // therefore demands a live print, and a position that falls due over a
        // weekend waits for the open.
        if (!marketOpen || uint64(block.timestamp) - printedAt > oracle.maxAge()) revert MarketShut();
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
        // The liquidator's leg may revert — they chose to be here, and a
        // liquidator who cannot receive the collateral should not be paid.
        IERC20(l.stock).safeTransfer(msg.sender, seizeShares);
        // The borrower's leg may not: a blocked borrower must not be able to
        // hold the whole position hostage.
        _deliver(l.stock, l.borrower, returnShares);

        emit LoanLiquidated(loanId, msg.sender, debt, seizeShares, returnShares, usdPerShare);
    }

    /**
     * @dev Try to hand `amount` of `token` to `to`; if the token refuses,
     *      credit it instead of reverting. A low-level call rather than
     *      SafeERC20 precisely because a revert here must not be fatal.
     */
    function _deliver(address token, address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (ok && (ret.length == 0 || abi.decode(ret, (bool)))) return;
        claimable[to][token] += amount;
        emit DeliveryDeferred(to, token, amount);
    }

    /// @notice Collect shares that could not be delivered at the time.
    function claim(address token) external nonReentrant returns (uint256 amount) {
        amount = claimable[msg.sender][token];
        if (amount == 0) revert ZeroAmount();
        claimable[msg.sender][token] = 0;
        // This one may revert: if the holder still cannot receive, the balance
        // should stay owed to them rather than vanish.
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, token, amount);
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

    function loanIdForOrder(address merchant, bytes32 orderRef, address borrower)
        external
        view
        returns (bool found, uint256 loanId)
    {
        uint256 v = _orderToLoan[keccak256(abi.encode(merchant, orderRef, borrower))];
        return v == 0 ? (false, 0) : (true, v - 1);
    }

    function amountOwed(uint256 loanId) external view returns (uint256) {
        Loan memory l = _loans[loanId];
        if (l.status != Status.Active) return 0;
        return l.principal + l.fee;
    }
}
