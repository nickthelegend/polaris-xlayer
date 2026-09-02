// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice A settable stand-in for Chainlink's L2 Sequencer Uptime feed.
 *
 * @dev Exists so the outage path can actually be exercised in tests — you
 *      cannot take a real sequencer down to check that liquidations are
 *      blocked. It is never deployed by any production script; the engine
 *      points at Chainlink's real feed on mainnet and at address(0) on
 *      networks that have none.
 */
contract SequencerFeedStub {
    int256 private _answer; // 0 = up, 1 = down
    uint256 private _startedAt;

    constructor() {
        _startedAt = block.timestamp;
    }

    function set(int256 answer_, uint256 startedAt_) external {
        _answer = answer_;
        _startedAt = startedAt_;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, _answer, _startedAt, _startedAt, 1);
    }
}
