// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface ICollateralBoost {
    function creditBoostOf(address user) external view returns (uint256);
}

/**
 * @title ScoreManager
 * @notice FICO-style credit scores (300-850) driven by on-chain repayment
 *         behaviour. The score sets how much a borrower may draw.
 *
 * @dev Scores move on facts the protocol observes itself -- an installment
 *      paid on time, an installment paid late, a liquidation -- so credit
 *      history is earned rather than attested. Only registered writers
 *      (the LoanEngine) may record events.
 */
contract ScoreManager is Ownable {
    uint16 public constant MIN_SCORE = 300;
    uint16 public constant MAX_SCORE = 850;
    uint16 public constant STARTING_SCORE = 600;

    // Deliberately asymmetric: trust is slow to earn and fast to lose, which
    // is both how real credit bureaus behave and the correct bias for an
    // undercollateralized book.
    uint16 public constant ON_TIME_BONUS = 12;
    uint16 public constant LATE_PENALTY = 40;
    uint16 public constant DEFAULT_PENALTY = 150;

    struct Profile {
        uint16 score;
        uint32 onTimePayments;
        uint32 latePayments;
        uint32 liquidations;
        uint64 firstSeenAt;
        bool initialized;
    }

    mapping(address => Profile) private _profiles;
    mapping(address => bool) public isWriter;

    /// Optional. Unset means the protocol runs as pure credit, no collateral.
    ICollateralBoost public collateralVault;

    event ScoreChanged(address indexed user, uint16 oldScore, uint16 newScore, string reason);
    event WriterSet(address indexed writer, bool allowed);
    event CollateralVaultSet(address indexed vault);

    error VaultNotAContract(address vault);

    error NotWriter();

    modifier onlyWriter() {
        if (!isWriter[msg.sender]) revert NotWriter();
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setWriter(address writer, bool allowed) external onlyOwner {
        isWriter[writer] = allowed;
        emit WriterSet(writer, allowed);
    }

    /**
     * @notice Point at the collateral vault, or clear it with the zero address.
     * @dev Rejects an address with no code. `creditLimitOf` wraps the vault call
     *      in try/catch so a misbehaving vault degrades to "no boost" rather
     *      than reverting every loan in the protocol, and that holds for a
     *      contract with the wrong ABI. It does NOT hold for an address with no
     *      code at all: the return-data decode failure is not catchable in
     *      Solidity, so `creditLimitOf` reverts, and since `createLoan` calls it
     *      on every origination, one owner typo bricks lending for every
     *      borrower. Cheaper to refuse the address than to discover that later.
     */
    function setCollateralVault(ICollateralBoost vault) external onlyOwner {
        if (address(vault) != address(0) && address(vault).code.length == 0) {
            revert VaultNotAContract(address(vault));
        }
        collateralVault = vault;
        emit CollateralVaultSet(address(vault));
    }

    /// @notice Score for a user, seeding a fresh profile at STARTING_SCORE.
    function scoreOf(address user) public view returns (uint16) {
        Profile storage p = _profiles[user];
        return p.initialized ? p.score : STARTING_SCORE;
    }

    function profileOf(address user) external view returns (Profile memory) {
        Profile memory p = _profiles[user];
        if (!p.initialized) {
            p.score = STARTING_SCORE;
        }
        return p;
    }

    /**
     * @notice Credit limit from score alone, in stablecoin base units.
     * @dev Piecewise rather than linear so the jumps are legible to a user
     *      ("get to 700 and your limit doubles") instead of a smooth curve
     *      nobody can reason about.
     */
    function baseLimitOf(address user) public view returns (uint256) {
        uint16 s = scoreOf(user);
        if (s >= 800) return 5_000e6;
        if (s >= 740) return 2_500e6;
        if (s >= 670) return 1_000e6;
        if (s >= 580) return 500e6;
        return 200e6;
    }

    /**
     * @notice The limit a borrower can actually draw: score plus any boost
     *         earned by locking collateral.
     *
     * @dev This is the single number the LoanEngine, the checkout SDK and both
     *      UIs read, so a borrower is never shown one limit and refused at
     *      another. The vault is optional -- with none configured this is
     *      exactly the score-derived limit, which is the pure credit product.
     *
     *      A failing vault call must not brick origination, so the boost is
     *      read defensively: an unreachable or misbehaving vault degrades to
     *      "no boost" rather than reverting every loan in the protocol.
     */
    function creditLimitOf(address user) external view returns (uint256) {
        uint256 base = baseLimitOf(user);
        if (address(collateralVault) == address(0)) {
            return base;
        }
        try collateralVault.creditBoostOf(user) returns (uint256 boost) {
            return base + boost;
        } catch {
            return base;
        }
    }

    function recordOnTimePayment(address user) external onlyWriter {
        Profile storage p = _touch(user);
        p.onTimePayments += 1;
        _adjust(user, p, int256(uint256(ON_TIME_BONUS)), "on-time payment");
    }

    function recordLatePayment(address user) external onlyWriter {
        Profile storage p = _touch(user);
        p.latePayments += 1;
        _adjust(user, p, -int256(uint256(LATE_PENALTY)), "late payment");
    }

    function recordLiquidation(address user) external onlyWriter {
        Profile storage p = _touch(user);
        p.liquidations += 1;
        _adjust(user, p, -int256(uint256(DEFAULT_PENALTY)), "liquidation");
    }

    function _touch(address user) private returns (Profile storage p) {
        p = _profiles[user];
        if (!p.initialized) {
            p.initialized = true;
            p.score = STARTING_SCORE;
            p.firstSeenAt = uint64(block.timestamp);
        }
    }

    function _adjust(address user, Profile storage p, int256 delta, string memory reason) private {
        uint16 old = p.score;
        int256 next = int256(uint256(old)) + delta;
        if (next < int256(uint256(MIN_SCORE))) next = int256(uint256(MIN_SCORE));
        if (next > int256(uint256(MAX_SCORE))) next = int256(uint256(MAX_SCORE));
        p.score = uint16(uint256(next));
        emit ScoreChanged(user, old, p.score, reason);
    }
}
