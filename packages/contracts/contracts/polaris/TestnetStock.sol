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
 *      to collateralise against. Rather than pretend otherwise, Polaris
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

    /**
     * @notice Issue shares. Owner only.
     * @dev This was an open mint, on the grounds that the token is worthless.
     *      That was wrong: the engine accepts this token as collateral, so an
     *      unpermissioned mint is an unpermissioned licence to print
     *      collateral and borrow the entire pool against it. Worthless to a
     *      market is not worthless to a lender that prices it.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// How much one address may draw from the faucet, in total.
    uint256 public constant FAUCET_LIMIT = 100e18;
    mapping(address => uint256) public faucetDrawn;

    error FaucetExhausted(uint256 drawn, uint256 limit);

    /**
     * @notice A capped faucet, so a demo can be run without the owner.
     * @dev Capped per address and priced far below the pool's float, so the
     *      worst case is someone borrowing against 100 shares rather than
     *      against infinity.
     */
    function faucet(uint256 amount) external {
        uint256 drawn = faucetDrawn[msg.sender] + amount;
        if (drawn > FAUCET_LIMIT) revert FaucetExhausted(drawn, FAUCET_LIMIT);
        faucetDrawn[msg.sender] = drawn;
        _mint(msg.sender, amount);
    }
}
