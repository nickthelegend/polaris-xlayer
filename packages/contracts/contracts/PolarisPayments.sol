// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PolarisPayments
 * @notice The two payment modes that are not credit: pay now, and subscribe.
 *
 * @dev Both use the same mechanism as BNPL collection -- the payer grants one
 *      ERC-20 allowance and the protocol draws against it -- because that is
 *      what lets a keeper charge on schedule without the payer being online.
 *      Recurring payments in crypto normally fail on exactly this point: the
 *      only alternative is an unlimited allowance the merchant can drain at
 *      will, which is why almost nobody ships subscriptions on chain.
 *
 *      What makes the allowance safe here is that this contract, not the
 *      merchant, is the spender, and it will only ever move `pricePerPeriod`
 *      and only once per `periodSeconds`. A subscriber can cancel at any time,
 *      and cancelling is unilateral -- it needs no merchant cooperation.
 *
 *      `chargeDue` is permissionless for the same reason `repay` is on the
 *      LoanEngine: funds can only travel subscriber -> merchant on a schedule
 *      the subscriber already agreed to, so a third-party keeper calling it is
 *      harmless and keeps collection decentralised.
 */
contract PolarisPayments is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Protocol fee on every payment, in basis points. 50 = 0.5%.
    uint256 public feeBps = 50;
    uint256 public constant MAX_FEE_BPS = 500;

    IERC20 public immutable stablecoin;
    address public treasury;

    // -----------------------------------------------------------------
    // Direct payments
    // -----------------------------------------------------------------

    struct Payment {
        address payer;
        address merchant;
        uint128 amount;
        uint64 paidAt;
    }

    mapping(bytes32 => Payment) public payments;
    uint256 public paymentCount;

    event PaymentMade(
        bytes32 indexed paymentId,
        address indexed payer,
        address indexed merchant,
        uint256 amount,
        uint256 fee,
        string orderId
    );

    // -----------------------------------------------------------------
    // Subscriptions
    // -----------------------------------------------------------------

    enum SubStatus {
        Active,
        Cancelled,
        Lapsed
    }

    struct Plan {
        address merchant;
        uint128 pricePerPeriod;
        uint64 periodSeconds;
        bool active;
        string name;
    }

    struct Subscription {
        address subscriber;
        uint256 planId;
        uint64 startedAt;
        uint64 nextChargeAt;
        uint32 periodsCharged;
        uint32 missedCharges;
        SubStatus status;
    }

    mapping(uint256 => Plan) public plans;
    mapping(uint256 => Subscription) public subscriptions;
    /// One live subscription per (subscriber, plan), so a double-subscribe is
    /// impossible rather than merely discouraged.
    mapping(address => mapping(uint256 => uint256)) public subscriptionOf;

    uint256 public planCount;
    uint256 public subscriptionCount;

    /// How long after the due time a charge may still be collected. Past this
    /// the period is skipped rather than stacked, so a subscriber returning
    /// after a month is not hit with four charges at once.
    uint64 public constant CHARGE_WINDOW = 7 days;
    /// Consecutive misses before a subscription lapses.
    uint32 public constant MAX_MISSES = 3;

    event PlanCreated(uint256 indexed planId, address indexed merchant, uint256 price, uint64 period);
    event PlanDeactivated(uint256 indexed planId);
    event Subscribed(uint256 indexed subId, uint256 indexed planId, address indexed subscriber);
    event SubscriptionCharged(uint256 indexed subId, uint256 amount, uint256 fee, uint32 period);
    event SubscriptionCancelled(uint256 indexed subId, address indexed by);
    event SubscriptionLapsed(uint256 indexed subId, uint32 misses);
    event ChargeMissed(uint256 indexed subId, uint32 misses, string reason);
    event FeeChanged(uint256 bps);

    error ZeroAmount();
    error PlanNotActive();
    error AlreadySubscribed();
    error NotSubscriber();
    error SubscriptionNotActive();
    error NotDue();
    error InvalidPeriod();
    error InvalidFee();
    error DuplicatePayment();

    constructor(address initialOwner, IERC20 _stablecoin, address _treasury)
        Ownable(initialOwner)
    {
        stablecoin = _stablecoin;
        treasury = _treasury;
    }

    function setFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert InvalidFee();
        feeBps = bps;
        emit FeeChanged(bps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    // -----------------------------------------------------------------
    // Direct payment
    // -----------------------------------------------------------------

    /**
     * @notice Pay a merchant in full, now.
     * @dev `orderId` is hashed with the merchant to form the payment id, so a
     *      merchant cannot be paid twice for the same order by a retrying
     *      checkout -- the second call reverts rather than charging again.
     */
    function pay(address merchant, uint256 amount, string calldata orderId)
        external
        nonReentrant
        returns (bytes32 paymentId)
    {
        if (amount == 0) revert ZeroAmount();

        paymentId = keccak256(abi.encodePacked(merchant, orderId));
        if (payments[paymentId].paidAt != 0) revert DuplicatePayment();

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 net = amount - fee;

        stablecoin.safeTransferFrom(msg.sender, merchant, net);
        if (fee > 0) {
            stablecoin.safeTransferFrom(msg.sender, treasury, fee);
        }

        payments[paymentId] = Payment({
            payer: msg.sender,
            merchant: merchant,
            amount: uint128(amount),
            paidAt: uint64(block.timestamp)
        });
        paymentCount++;

        emit PaymentMade(paymentId, msg.sender, merchant, amount, fee, orderId);
    }

    function paymentFor(address merchant, string calldata orderId)
        external
        view
        returns (Payment memory)
    {
        return payments[keccak256(abi.encodePacked(merchant, orderId))];
    }

    // -----------------------------------------------------------------
    // Subscriptions
    // -----------------------------------------------------------------

    function createPlan(uint256 pricePerPeriod, uint64 periodSeconds, string calldata name)
        external
        returns (uint256 planId)
    {
        if (pricePerPeriod == 0) revert ZeroAmount();
        // A period under an hour is almost certainly a mistake, and one over a
        // year makes the allowance a standing risk for no benefit.
        if (periodSeconds < 1 hours || periodSeconds > 365 days) revert InvalidPeriod();

        planId = ++planCount;
        plans[planId] = Plan({
            merchant: msg.sender,
            pricePerPeriod: uint128(pricePerPeriod),
            periodSeconds: periodSeconds,
            active: true,
            name: name
        });
        emit PlanCreated(planId, msg.sender, pricePerPeriod, periodSeconds);
    }

    function deactivatePlan(uint256 planId) external {
        Plan storage p = plans[planId];
        if (p.merchant != msg.sender) revert NotSubscriber();
        p.active = false;
        emit PlanDeactivated(planId);
    }

    /**
     * @notice Subscribe and pay the first period immediately.
     * @dev Charging period one at subscribe time means a subscription always
     *      starts from a proven-good payment, so a plan can never sit "active"
     *      having never collected anything.
     */
    function subscribe(uint256 planId) external nonReentrant returns (uint256 subId) {
        Plan storage p = plans[planId];
        if (!p.active) revert PlanNotActive();

        uint256 existing = subscriptionOf[msg.sender][planId];
        if (existing != 0 && subscriptions[existing].status == SubStatus.Active) {
            revert AlreadySubscribed();
        }

        subId = ++subscriptionCount;
        subscriptions[subId] = Subscription({
            subscriber: msg.sender,
            planId: planId,
            startedAt: uint64(block.timestamp),
            nextChargeAt: uint64(block.timestamp) + p.periodSeconds,
            periodsCharged: 1,
            missedCharges: 0,
            status: SubStatus.Active
        });
        subscriptionOf[msg.sender][planId] = subId;

        _settle(p.merchant, msg.sender, p.pricePerPeriod);
        emit Subscribed(subId, planId, msg.sender);
        emit SubscriptionCharged(subId, p.pricePerPeriod, _fee(p.pricePerPeriod), 1);
    }

    /// @notice True when this subscription is collectable right now.
    function isChargeDue(uint256 subId) public view returns (bool) {
        Subscription storage s = subscriptions[subId];
        if (s.status != SubStatus.Active) return false;
        return block.timestamp >= s.nextChargeAt;
    }

    /**
     * @notice Collect one period. Permissionless -- this is the keeper entry
     *         point, and it is the subscription analogue of `LoanEngine.repay`.
     */
    function chargeDue(uint256 subId) external nonReentrant {
        Subscription storage s = subscriptions[subId];
        if (s.status != SubStatus.Active) revert SubscriptionNotActive();
        if (block.timestamp < s.nextChargeAt) revert NotDue();

        Plan storage p = plans[s.planId];

        // Past the window the period is skipped, not stacked. Advancing to the
        // next boundary rather than adding one period stops a long-absent
        // subscriber from owing a backlog of charges they never consumed.
        if (block.timestamp > s.nextChargeAt + CHARGE_WINDOW) {
            s.missedCharges += 1;
            uint64 periods = (uint64(block.timestamp) - s.nextChargeAt) / p.periodSeconds + 1;
            s.nextChargeAt += periods * p.periodSeconds;
            emit ChargeMissed(subId, s.missedCharges, "charge window elapsed");

            if (s.missedCharges >= MAX_MISSES) {
                s.status = SubStatus.Lapsed;
                emit SubscriptionLapsed(subId, s.missedCharges);
            }
            return;
        }

        _settle(p.merchant, s.subscriber, p.pricePerPeriod);

        s.periodsCharged += 1;
        s.missedCharges = 0;
        s.nextChargeAt += p.periodSeconds;

        emit SubscriptionCharged(subId, p.pricePerPeriod, _fee(p.pricePerPeriod), s.periodsCharged);
    }

    /**
     * @notice Cancel. The subscriber can always do this unilaterally; the
     *         merchant can also cancel, which is how a merchant offboards.
     */
    function cancel(uint256 subId) external {
        Subscription storage s = subscriptions[subId];
        if (s.status != SubStatus.Active) revert SubscriptionNotActive();
        if (msg.sender != s.subscriber && msg.sender != plans[s.planId].merchant) {
            revert NotSubscriber();
        }
        s.status = SubStatus.Cancelled;
        emit SubscriptionCancelled(subId, msg.sender);
    }

    function getSubscription(uint256 subId) external view returns (Subscription memory) {
        return subscriptions[subId];
    }

    function getPlan(uint256 planId) external view returns (Plan memory) {
        return plans[planId];
    }

    // -----------------------------------------------------------------

    function _fee(uint256 amount) private view returns (uint256) {
        return (amount * feeBps) / 10_000;
    }

    /// Move funds payer -> merchant, net of fee, in one place so direct
    /// payments and subscriptions cannot drift apart on fee handling.
    function _settle(address merchant, address payer, uint256 amount) private {
        uint256 fee = _fee(amount);
        stablecoin.safeTransferFrom(payer, merchant, amount - fee);
        if (fee > 0) {
            stablecoin.safeTransferFrom(payer, treasury, fee);
        }
    }
}
