// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title CreditOracle
 * @dev Stores attested external loan data (Aave, Morpho, Compound) to calculate global credit limits.
 */
contract CreditOracle is Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct CreditProfile {
        uint256 totalCollateralUsd;
        uint256 totalDebtUsd;
        uint256 lastUpdate;
        uint256 nonce;
    }

    address public attester;
    mapping(address => CreditProfile) public profiles;

    event ProfileUpdated(address indexed user, uint256 collateral, uint256 debt);
    event AttesterChanged(address indexed oldAttester, address indexed newAttester);

    constructor(address _attester) Ownable(msg.sender) {
        attester = _attester;
    }

    function setAttester(address _attester) external onlyOwner {
        emit AttesterChanged(attester, _attester);
        attester = _attester;
    }

    /**
     * @dev Updates a user's credit profile using a signed attestation from the trusted attester.
     * @param user The user address.
     * @param collateral Total collateral value in USD (scaled by 1e18 or as needed).
     * @param debt Total debt value in USD.
     * @param timestamp Expiry/Timestamp of the attestation.
     * @param signature The attester's signature.
     */
    function updateProfile(
        address user,
        uint256 collateral,
        uint256 debt,
        uint256 timestamp,
        bytes calldata signature
    ) external {
        require(timestamp > block.timestamp - 1 hours, "Attestation expired");
        
        bytes32 messageHash = keccak256(abi.encodePacked(
            user,
            collateral,
            debt,
            timestamp,
            profiles[user].nonce
        ));
        
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(signature);
        
        require(signer == attester, "Invalid signature");

        profiles[user].totalCollateralUsd = collateral;
        profiles[user].totalDebtUsd = debt;
        profiles[user].lastUpdate = block.timestamp;
        profiles[user].nonce++;

        emit ProfileUpdated(user, collateral, debt);
    }

    function getExternalNetValue(address user) external view returns (int256) {
        CreditProfile memory p = profiles[user];
        if (p.lastUpdate == 0 || p.lastUpdate < block.timestamp - 7 days) {
            return 0; // Stale or no data
        }
        return int256(p.totalCollateralUsd) - int256(p.totalDebtUsd);
    }
}
