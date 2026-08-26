// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MerchantRegistry
 * @notice On-chain merchant directory. The registry entry is the merchant's
 *         identity for settlement and the source of truth the checkout SDK
 *         reads before letting a buyer split a purchase.
 *
 * @dev Merchants self-register and are activated by the protocol. Per-merchant
 *      caps exist because BNPL exposure is a function of who is selling as much
 *      as who is buying -- a merchant with a high refund or dispute rate should
 *      be able to originate less, and that lever has to live on chain where the
 *      LoanEngine can see it.
 */
contract MerchantRegistry is Ownable {
    struct Merchant {
        address payoutAddress;
        string name;
        string metadataURI;
        uint128 maxOrderValue;
        uint128 totalSettled;
        uint64 registeredAt;
        bool active;
    }

    mapping(address => Merchant) private _merchants;
    address[] private _merchantList;

    event MerchantRegistered(address indexed merchant, string name, address payoutAddress);
    event MerchantActivated(address indexed merchant, bool active);
    event MerchantUpdated(address indexed merchant, address payoutAddress, uint128 maxOrderValue);
    event SettlementRecorded(address indexed merchant, uint256 amount);

    error AlreadyRegistered();
    error NotRegistered();
    error NotMerchantOwner();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function register(
        string calldata name,
        address payoutAddress,
        string calldata metadataURI
    ) external {
        if (_merchants[msg.sender].registeredAt != 0) revert AlreadyRegistered();
        _merchants[msg.sender] = Merchant({
            payoutAddress: payoutAddress,
            name: name,
            metadataURI: metadataURI,
            // Conservative default until the protocol raises it; a brand new
            // merchant should not be able to originate unlimited credit.
            maxOrderValue: 500e6,
            totalSettled: 0,
            registeredAt: uint64(block.timestamp),
            active: false
        });
        _merchantList.push(msg.sender);
        emit MerchantRegistered(msg.sender, name, payoutAddress);
    }

    function setActive(address merchant, bool active) external onlyOwner {
        if (_merchants[merchant].registeredAt == 0) revert NotRegistered();
        _merchants[merchant].active = active;
        emit MerchantActivated(merchant, active);
    }

    function setMaxOrderValue(address merchant, uint128 maxOrderValue) external onlyOwner {
        if (_merchants[merchant].registeredAt == 0) revert NotRegistered();
        _merchants[merchant].maxOrderValue = maxOrderValue;
        emit MerchantUpdated(merchant, _merchants[merchant].payoutAddress, maxOrderValue);
    }

    function updatePayoutAddress(address payoutAddress) external {
        Merchant storage m = _merchants[msg.sender];
        if (m.registeredAt == 0) revert NotRegistered();
        m.payoutAddress = payoutAddress;
        emit MerchantUpdated(msg.sender, payoutAddress, m.maxOrderValue);
    }

    function recordSettlement(address merchant, uint256 amount) external onlyOwner {
        _merchants[merchant].totalSettled += uint128(amount);
        emit SettlementRecorded(merchant, amount);
    }

    function merchantOf(address merchant) external view returns (Merchant memory) {
        return _merchants[merchant];
    }

    /// @notice Whether this merchant may originate a plan of this size.
    function canOriginate(address merchant, uint256 orderValue) external view returns (bool) {
        Merchant storage m = _merchants[merchant];
        return m.active && orderValue <= m.maxOrderValue;
    }

    function merchantCount() external view returns (uint256) {
        return _merchantList.length;
    }

    function merchantAt(uint256 index) external view returns (address) {
        return _merchantList[index];
    }
}
