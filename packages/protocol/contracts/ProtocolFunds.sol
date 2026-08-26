// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ProtocolFunds
 * @dev Stores and manages protocol fees collected from loans.
 */
contract ProtocolFunds is Ownable {
    mapping(address => uint256) public tokenBalances;
    
    event FundsDeposited(address indexed token, uint256 amount);
    event FundsWithdrawn(address indexed token, uint256 amount, address indexed to);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @dev Record a deposit of protocol fees (virtual accounting on Hub).
     */
    function deposit(address token, uint256 amount) external {
        tokenBalances[token] += amount;
        emit FundsDeposited(token, amount);
    }

    /**
     * @dev Withdraw funds (decrements virtual balance, requires authorization on spoke for real tokens).
     */
    function withdraw(address token, uint256 amount, address to) external onlyOwner {
        require(tokenBalances[token] >= amount, "Insufficient protocol funds");
        tokenBalances[token] -= amount;
        emit FundsWithdrawn(token, amount, to);
    }
}
