// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title InsurancePool
 * @dev Staked collateral acts as a buffer for BNPL defaults.
 *
 * `stakeCTC` used to read:
 *
 *     // Mock transfer from user
 *     stakedCTC[msg.sender] += amount;
 *
 * — it credited any caller any amount and moved nothing. The buffer that is
 * supposed to absorb defaults could be inflated to any size by anyone, for
 * free, and `slashInsurance` would then burn down a number backed by nothing.
 * A pool whose balance is a number rather than a balance is worse than no pool,
 * because the protocol sizes its risk against it.
 *
 * The stake is a real ERC20 transfer now, slashing moves real tokens to a
 * recipient, and stakers can withdraw what they actually put in.
 */
contract InsurancePool is Ownable {
    using SafeERC20 for IERC20;

    /// The token this pool is denominated in. Immutable: a pool that can be
    /// repointed at a different token after people have staked is a rug.
    IERC20 public immutable token;

    mapping(address => uint256) public stakedCTC;
    uint256 public totalStaked;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event Slashed(address indexed to, uint256 amount);

    error ZeroAmount();
    error InsufficientStake();
    error InsufficientInsurance();

    constructor(IERC20 token_) Ownable(msg.sender) {
        require(address(token_) != address(0), "token required");
        token = token_;
    }

    /// Stake. The caller must have approved this contract for `amount` first.
    function stakeCTC(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        // Credit only what actually arrives, so a fee-on-transfer token cannot
        // leave the pool's accounting ahead of its balance.
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;

        stakedCTC[msg.sender] += received;
        totalStaked += received;
        emit Staked(msg.sender, received);
    }

    /// Withdraw your own stake. Slashing reduces the pool, so this can fail
    /// after a slash — which is the point of a buffer.
    function unstake(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (stakedCTC[msg.sender] < amount) revert InsufficientStake();
        if (totalStaked < amount) revert InsufficientInsurance();

        stakedCTC[msg.sender] -= amount;
        totalStaked -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /// Draw on the buffer to cover a default. Moves real tokens out.
    function slashInsurance(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAmount();
        if (totalStaked < amount) revert InsufficientInsurance();

        totalStaked -= amount;
        token.safeTransfer(to, amount);
        emit Slashed(to, amount);
    }
}
