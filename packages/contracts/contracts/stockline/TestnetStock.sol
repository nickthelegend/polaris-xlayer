// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TestnetStock
 * @notice A stand-in for a tokenized share, for X Layer testnet only.
 *
 * @dev This is NOT a security and NOT a claim on anything. Real tokenized
 *      equities — xStocks and the like — are issued by regulated parties and
 *      are not deployed on X Layer testnet, so there is nothing on this chain
 *      to collateralise against. Rather than pretend otherwise, Stockline
 *      deploys this: a plain ERC-20 that stands where the real share token
 *      would sit, so every other contract in the system is exercised against
 *      the same interface it will meet in production.
 *
 *      Swapping this for a real xStock is a one-line change of address in the
 *      deployment; no contract below it knows the difference.
 *
 *      It is deliberately named so nobody can mistake it for the real thing on
 *      an explorer: symbol `tXAAPL`, name "Testnet Apple (NOT A SECURITY)".
 */
contract TestnetStock is ERC20, Ownable {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Open faucet. This token has no value; gating it would only
    ///         make the demo harder to run.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
