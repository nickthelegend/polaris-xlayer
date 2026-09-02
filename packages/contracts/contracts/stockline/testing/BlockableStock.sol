// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice A share token whose issuer can block an address, the way a real
 *         tokenized equity can.
 * @dev Test-only. It exists so the engine can be checked against the thing
 *      that actually distinguishes a regulated instrument from a plain
 *      ERC-20: the issuer's ability to refuse a holder.
 */
contract BlockableStock is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("Blockable Share", "bSHR") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address who, bool v) external {
        blocked[who] = v;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[to] && !blocked[from], "BLOCKED");
        super._update(from, to, value);
    }
}
