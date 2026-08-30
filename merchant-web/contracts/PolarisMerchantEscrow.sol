// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PolarisMerchantEscrow
 * @dev A simple escrow contract for merchants to receive payments from the Polaris protocol.
 * The deployed address acts as theMerchant ID / API Key.
 */
contract PolarisMerchantEscrow {
    address public owner;
    address public stablecoin;
    
    // Log event for the settlement
    event PaymentSettled(
        address indexed payer,
        uint256 amount,
        string orderId,
        string details,
        uint256 timestamp
    );

    event FundsWithdrawn(
        address indexed owner,
        uint256 amount,
        uint256 timestamp
    );

    constructor(address _stablecoin) {
        owner = msg.sender;
        stablecoin = _stablecoin;
    }

    /**
     * @dev Called by the Polaris Protocol (user wallet/contract) to settle a credit payment.
     * @param amount The amount of stablecoin to transfer.
     * @param orderId External order ID for reconciliation.
     * @param details Metadata string (JSON or description of items bought).
     */
    function settlePayment(uint256 amount, string memory orderId, string memory details) external {
        require(amount > 0, "Amount must be > 0");
        
        // Transfer USDC from payer to this escrow
        // secure transfer: implementation depends on token standard wrapping or interface usage
        // For simplicity assuming standard IERC20 transferFrom
        // The user must verify approve() first
        
        // Using low-level call for generic ERC20 to avoid importing openzeppelin for this snippet
        (bool success, bytes memory data) = stablecoin.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");

        emit PaymentSettled(msg.sender, amount, orderId, details, block.timestamp);
    }

    /**
     * @dev Merchant withdraws their accumulated funds.
     */
    function withdraw() external {
        require(msg.sender == owner, "Only owner");
        
        // Get balance
        // Using staticcall to get balance
        (bool successBalance, bytes memory balanceData) = stablecoin.staticcall(
            abi.encodeWithSignature("balanceOf(address)", address(this))
        );
        require(successBalance, "Balance fetch failed");
        uint256 balance = abi.decode(balanceData, (uint256));
        require(balance > 0, "No funds");

        // Transfer to owner
        (bool successTransfer, bytes memory transferData) = stablecoin.call(
            abi.encodeWithSignature("transfer(address,uint256)", owner, balance)
        );
        require(successTransfer && (transferData.length == 0 || abi.decode(transferData, (bool))), "Withdraw failed");

        emit FundsWithdrawn(owner, balance, block.timestamp);
    }

    /**
     * @dev Withdraw funds from the MerchantRouter that are credited to this escrow contract.
     * @param router The address of the MerchantRouter contract.
     * @param amount The amount to withdraw.
     * @param destChainId The destination chain ID (usually current chain).
     */
    function withdrawFromRouter(address router, uint256 amount, uint64 destChainId) external {
        require(msg.sender == owner, "Only owner");
        
        // Call merchantWithdraw(address token, uint256 amount, uint64 destChainId) on router
        (bool success, ) = router.call(
            abi.encodeWithSignature("merchantWithdraw(address,uint256,uint64)", stablecoin, amount, destChainId)
        );
        require(success, "Router withdrawal failed");
    }
}
