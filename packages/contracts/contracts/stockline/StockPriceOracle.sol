// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title StockPriceOracle
 * @notice What a share is worth, and whether the market was open when we asked.
 *
 * @dev Stockline lends against tokenized equity, so the price is the whole
 *      product: get it wrong and the book is wrong. Two things matter and both
 *      are recorded on chain rather than assumed.
 *
 *      **Staleness.** A price carries the timestamp of the print it came from,
 *      not the block it was posted in. A consumer asks for a price and gets a
 *      revert if it has aged past `maxAge`, because a lender quietly using
 *      yesterday's close is how a book blows up on a gap open.
 *
 *      **Market hours.** Equities do not trade 24/7 but this chain does. The
 *      relayer publishes whether the venue was open for that print, and
 *      borrowers opening a position while the market is shut are haircut by
 *      the engine. This is a flag from the relayer rather than an on-chain
 *      clock calculation on purpose: NYSE hours are 9:30-16:00 America/New_York
 *      with daylight saving and a holiday calendar, and reimplementing that in
 *      Solidity would be a second source of truth that silently drifts from
 *      the first.
 *
 *      The relayer is trusted to publish honestly and that is stated plainly
 *      rather than dressed up. `source` names where the print came from and is
 *      shown on the receipt, so a user can check the number against the venue.
 */
contract StockPriceOracle is Ownable {
    struct Price {
        /// USD per share, scaled by 1e8 — the convention Chainlink feeds use,
        /// so a real feed can be dropped in behind this interface unchanged.
        uint256 usdPerShare;
        /// When the venue printed it. Not when it was posted here.
        uint64 printedAt;
        /// Was the venue open for this print?
        bool marketOpen;
    }

    uint8 public constant DECIMALS = 8;

    mapping(address => Price) private _prices;
    mapping(address => string) public sourceOf;
    mapping(address => bool) public isRelayer;

    /// A price older than this is not a price. 15 minutes by default.
    uint64 public maxAge = 15 minutes;

    event PricePosted(address indexed stock, uint256 usdPerShare, uint64 printedAt, bool marketOpen, string source);
    event RelayerSet(address indexed relayer, bool allowed);
    event MaxAgeSet(uint64 seconds_);

    error NotRelayer();
    error NoPrice(address stock);
    error StalePrice(address stock, uint64 printedAt, uint64 age);
    error PriceInFuture(uint64 printedAt, uint64 now_);
    error ZeroPrice();

    constructor(address owner_) Ownable(owner_) {
        isRelayer[owner_] = true;
        emit RelayerSet(owner_, true);
    }

    modifier onlyRelayer() {
        if (!isRelayer[msg.sender]) revert NotRelayer();
        _;
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        isRelayer[relayer] = allowed;
        emit RelayerSet(relayer, allowed);
    }

    function setMaxAge(uint64 seconds_) external onlyOwner {
        require(seconds_ >= 60, "maxAge too tight");
        maxAge = seconds_;
        emit MaxAgeSet(seconds_);
    }

    /**
     * @notice Publish a print.
     * @dev `printedAt` in the future is rejected: it would defeat the staleness
     *      check entirely, which is the one thing this contract exists to do.
     */
    function postPrice(
        address stock,
        uint256 usdPerShare,
        uint64 printedAt,
        bool marketOpen,
        string calldata source
    ) external onlyRelayer {
        if (usdPerShare == 0) revert ZeroPrice();
        if (printedAt > block.timestamp) revert PriceInFuture(printedAt, uint64(block.timestamp));
        _prices[stock] = Price(usdPerShare, printedAt, marketOpen);
        sourceOf[stock] = source;
        emit PricePosted(stock, usdPerShare, printedAt, marketOpen, source);
    }

    /// @notice The price, or a revert. Never a silently stale number.
    function getPrice(address stock) external view returns (uint256 usdPerShare, uint64 printedAt, bool marketOpen) {
        Price memory p = _prices[stock];
        if (p.usdPerShare == 0) revert NoPrice(stock);
        uint64 age = uint64(block.timestamp) - p.printedAt;
        if (age > maxAge) revert StalePrice(stock, p.printedAt, age);
        return (p.usdPerShare, p.printedAt, p.marketOpen);
    }

    /// @notice Read without reverting, for UIs that want to show why it is unusable.
    function peek(address stock)
        external
        view
        returns (uint256 usdPerShare, uint64 printedAt, bool marketOpen, bool fresh)
    {
        Price memory p = _prices[stock];
        if (p.usdPerShare == 0) return (0, 0, false, false);
        uint64 age = uint64(block.timestamp) - p.printedAt;
        return (p.usdPerShare, p.printedAt, p.marketOpen, age <= maxAge);
    }
}
