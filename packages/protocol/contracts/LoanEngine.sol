// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ScoreManager.sol";
import "./PoolManager.sol";
import "./interfaces/INativeQueryVerifier.sol";
import "./interfaces/EvmV1Decoder.sol";

import "./ProtocolFunds.sol";

contract LoanEngine is Ownable, ReentrancyGuard {
    ScoreManager public scoreManager;
    PoolManager public poolManager;
    ProtocolFunds public protocolFunds;
    INativeQueryVerifier public immutable VERIFIER;
    
    uint256 public constant INTEREST_RATE_BPS = 1000; // 10% APR
    uint256 public constant PROTOCOL_FEE_BPS = 2000; // 20% of interest goes to protocol
    
    bytes32 public constant REPAY_EVENT_SIGNATURE = 0x040cee90ee4799897c30ca04e5feb6fa43dbba9b6d084b4b257cdafd84ba013e;

    enum LoanStatus { Active, Repaid, Defaulted }
    struct Loan { 
        address borrower; 
        uint256 principal; 
        uint256 interestAmount;
        uint256 repaid; 
        uint256 startTime; 
        uint256[] dueDates; 
        LoanStatus status; 
        address poolToken; 
    }
    mapping(uint256 => Loan) public loans;
    mapping(address => uint256) public userActiveDebt;
    mapping(bytes32 => bool) public processedQueries;
    uint256 public loanCount;

    event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 interest);
    event RepaymentMade(uint256 indexed loanId, uint256 amount);
    event LoanDefaulted(uint256 indexed loanId);
    event LoanFullyRepaid(uint256 indexed loanId);

    constructor(address _scoreManager, address _poolManager, address _verifier, address _protocolFunds) Ownable(msg.sender) {
        scoreManager = ScoreManager(_scoreManager);
        poolManager = PoolManager(_poolManager);
        protocolFunds = ProtocolFunds(_protocolFunds);
        if (_verifier == address(0)) {
            VERIFIER = NativeQueryVerifierLib.getVerifier();
        } else {
            VERIFIER = INativeQueryVerifier(_verifier);
        }
    }

    function createLoan(address user, uint256 amount, address poolToken) external {
        uint256 limit = scoreManager.getCreditLimit(user);
        require(userActiveDebt[user] + amount <= limit, "Exceeds limit");
        
        // Calculate 56-day interest (standard for this BNPL model)
        // interest = principal * rate * time / 365
        uint256 interest = (amount * INTEREST_RATE_BPS * 56) / (10000 * 365);
        if (interest == 0) interest = 1; // Minimum 1 unit interest for demo

        uint256[] memory dueDates = new uint256[](4);
        dueDates[0] = block.timestamp + 14 days;
        dueDates[1] = block.timestamp + 28 days;
        dueDates[2] = block.timestamp + 42 days;
        dueDates[3] = block.timestamp + 56 days;

        loans[loanCount] = Loan({ 
            borrower: user, 
            principal: amount, 
            interestAmount: interest,
            repaid: 0, 
            startTime: block.timestamp, 
            dueDates: dueDates, 
            status: LoanStatus.Active, 
            poolToken: poolToken 
        });
        
        userActiveDebt[user] += amount;
        emit LoanCreated(loanCount, user, amount, interest);
        loanCount++;
    }

    function repayFromProof(
        uint64 chainKey, uint64 blockHeight, bytes calldata encodedTransaction,
        bytes32 merkleRoot, INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest, bytes32[] calldata continuityRoots
    ) external nonReentrant {
        (bool isNotReplay, bytes32 txKey) = _checkForReplay(chainKey, blockHeight, siblings);
        require(isNotReplay, "Processed");

        require(VERIFIER.verifyAndEmit(
            chainKey, blockHeight, encodedTransaction,
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings}),
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots})
        ), "Native failed");

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Failed on source");

        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, REPAY_EVENT_SIGNATURE);
        require(logs.length > 0, "No Repayment events");

        for (uint i = 0; i < logs.length; i++) {
            require(logs[i].topics.length == 2, "Invalid topics");
            uint256 loanId = uint256(logs[i].topics[1]);
            uint256 amount = abi.decode(logs[i].data, (uint256));
            _applyRepayment(loanId, amount);
        }
        processedQueries[txKey] = true;
    }

    function _applyRepayment(uint256 loanId, uint256 amount) internal {
        Loan storage loan = loans[loanId];
        require(loan.status == LoanStatus.Active, "Not active");
        
        uint256 totalDebt = loan.principal + loan.interestAmount;
        uint256 remainingToRepay = totalDebt - loan.repaid;
        uint256 effectiveAmount = amount > remainingToRepay ? remainingToRepay : amount;

        uint256 principalBefore = loan.repaid < loan.principal ? loan.repaid : loan.principal;
        
        loan.repaid += effectiveAmount;
        
        // Handle Interest Distribution
        uint256 interestPaid = 0;
        if (loan.repaid > loan.principal) {
            if (loan.repaid - effectiveAmount <= loan.principal) {
                interestPaid = loan.repaid - loan.principal;
            } else {
                interestPaid = effectiveAmount;
            }
        }

        if (interestPaid > 0) {
            uint256 protocolFee = (interestPaid * PROTOCOL_FEE_BPS) / 10000;
            uint256 lenderYield = interestPaid - protocolFee;
            
            if (protocolFee > 0) protocolFunds.deposit(loan.poolToken, protocolFee);
            if (lenderYield > 0) poolManager.distributeInterest(loan.poolToken, lenderYield);
        }

        scoreManager.recordRepayment(loan.borrower, effectiveAmount);
        emit RepaymentMade(loanId, effectiveAmount);
        
        if (loan.repaid >= totalDebt) {
            loan.status = LoanStatus.Repaid;
            userActiveDebt[loan.borrower] -= loan.principal;
            emit LoanFullyRepaid(loanId);
        }
    }

    function _checkForReplay(uint64 chainKey, uint64 blockHeight, INativeQueryVerifier.MerkleProofEntry[] memory siblings) 
        internal view returns (bool, bytes32 txKey) 
    {
        uint256 transactionIndex = NativeQueryVerifierLib._calculateTransactionIndex(siblings);
        txKey = keccak256(abi.encodePacked(chainKey, blockHeight, transactionIndex));
        return (!processedQueries[txKey], txKey);
    }

    function checkLiquidatable(uint256 loanId) public view returns (bool) {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active) return false;
        return (block.timestamp > loan.dueDates[3]);
    }

    function liquidate(uint256 loanId) external {
        require(checkLiquidatable(loanId), "Not liquidatable");
        Loan storage loan = loans[loanId];
        loan.status = LoanStatus.Defaulted;
        scoreManager.updateScore(loan.borrower, -50, "Defaulted Loan");
        uint256 outstanding = loan.principal - loan.repaid;
        poolManager.slashLiquidity(loan.borrower, loan.poolToken, outstanding);
        emit LoanDefaulted(loanId);
    }

    function repay(uint256 loanId, uint256 amount) external {
        Loan storage loan = loans[loanId];
        require(loan.borrower == msg.sender, "Only borrower");
        _applyRepayment(loanId, amount);
    }
}
