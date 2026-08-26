// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./PoolManager.sol";
import "./LoanEngine.sol";

/**
 * @title MerchantRouter
 * @dev Routes payments to merchants from Creditcoin pools.
 * Bridges Consumer Credit (Loans) to Merchant Liquidity.
 */
contract MerchantRouter is Ownable {
    PoolManager public poolManager;
    LoanEngine public loanEngine;

    // Merchant balances (in specific tokens)
    mapping(address => mapping(address => uint256)) public merchantBalances;

    event MerchantPaid(address indexed customer, address indexed merchant, address indexed token, uint256 amount);
    event MerchantWithdrawn(address indexed merchant, address indexed token, uint256 amount);

    constructor(address _poolManager, address _loanEngine) Ownable(msg.sender) {
        poolManager = PoolManager(_poolManager);
        loanEngine = LoanEngine(_loanEngine);
    }

    /**
     * @dev Customer pays a merchant using their credit line.
     * This automatically triggers a BNPL loan for the customer.
     */
    function payWithCredit(address merchant, address tokenOnSource, uint256 amount) external {
        // 1. Create a loan for the customer (msg.sender)
        // LoanEngine checks credit limit based on ScoreManager/LP balance
        loanEngine.createLoan(msg.sender, amount, tokenOnSource);

        // 2. Crediting the merchant
        // In a full implementation, this might bridge funds.
        // For USC demo, we track it on-chain.
        merchantBalances[merchant][tokenOnSource] += amount;

        emit MerchantPaid(msg.sender, merchant, tokenOnSource, amount);
    }

    /**
     * @dev Merchant withdraws their earned funds.
     */
    function merchantWithdraw(address tokenOnSource, uint256 amount, uint64 destChainId) external {
        require(merchantBalances[msg.sender][tokenOnSource] >= amount, "Insufficient merchant balance");
        
        merchantBalances[msg.sender][tokenOnSource] -= amount;
        
        // Relies on PoolManager to authorize withdrawal or send funds
        // For simplicity, we trigger a withdrawal request from the global pool
        poolManager.requestWithdrawal(tokenOnSource, amount, destChainId);

        emit MerchantWithdrawn(msg.sender, tokenOnSource, amount);
    }
}
