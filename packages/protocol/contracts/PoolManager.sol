// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/INativeQueryVerifier.sol";
import "./interfaces/EvmV1Decoder.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PoolManager is Ownable, ReentrancyGuard {
    INativeQueryVerifier public immutable VERIFIER;
    address public loanEngine;
    bytes32 public constant TRANSFER_EVENT_SIGNATURE = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    struct Pool { 
        uint256 totalLiquidity; 
        uint256 totalShares;
        address tokenOnSource; 
    }
    mapping(address => Pool) public pools;
    // user => token => shares
    mapping(address => mapping(address => uint256)) public lpShares;
    mapping(bytes32 => bool) public processedQueries;
    
    // Mapping of ChainID => TokenAddress => IsWhitelisted
    mapping(uint64 => mapping(address => bool)) public whitelistedSourceTokens;
    // Mapping of ChainID => LiquidityVaultAddress (The contract that must receive funds)
    mapping(uint64 => address) public sourceVaults;
    
    address[] public whitelistedTokens;
    mapping(address => bool) public isTokenWhitelisted;
    uint256 public withdrawalNonce;

    event LiquidityAdded(address indexed user, address indexed tokenOnSource, uint256 amount);
    event LiquidityWithdrawn(address indexed user, address indexed tokenOnSource, uint256 amount);
    event WithdrawalAuthorized(address indexed user, address indexed tokenOnSource, uint256 amount, uint256 nonce, uint64 destChainId);
    event LiquiditySlashed(address indexed user, address indexed tokenOnSource, uint256 amount);
    event SourceChainConfigured(uint64 indexed chainId, address indexed vault, address indexed token, bool status);
    event TokenWhitelisted(address indexed token, bool status);

    constructor(address _verifier) Ownable(msg.sender) {
        if (_verifier == address(0)) {
            VERIFIER = NativeQueryVerifierLib.getVerifier();
        } else {
            VERIFIER = INativeQueryVerifier(_verifier);
        }
    }

    function setWhitelistedToken(address token, bool status) external onlyOwner {
        if (status && !isTokenWhitelisted[token]) whitelistedTokens.push(token);
        isTokenWhitelisted[token] = status;
        emit TokenWhitelisted(token, status);
    }

    /** 
     * @dev Configures a source chain's LiquidityVault and whitelists a token on that chain.
     * @param chainId The Chain ID (or Chain Key for Prover)
     * @param vault The address of the LiquidityVault on that chain.
     * @param token The address of the ERC20 token on that chain (e.g. USDC).
     * @param status Whether to accept deposits of this token.
     */
    function setSourceParams(uint64 chainId, address vault, address token, bool status) external onlyOwner {
        sourceVaults[chainId] = vault;
        whitelistedSourceTokens[chainId][token] = status;
        emit SourceChainConfigured(chainId, vault, token, status);
    }

    // Legacy support for scripts calling the old function name, redirects to new logic if valid
    function setWhitelistedVault(uint64 chainId, address token, bool status) external onlyOwner {
        // This function name was confusing in previous version. 
        // We assume 'token' implies the Source Token.
        // We cannot set the Vault address here, so we warn or require it to be set separately.
        whitelistedSourceTokens[chainId][token] = status;
    }

    function setLoanEngine(address _loanEngine) external onlyOwner { loanEngine = _loanEngine; }

    function addLiquidityFromProof(
        uint64 chainKey, uint64 blockHeight, bytes calldata encodedTransaction,
        bytes32 merkleRoot, INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest, bytes32[] calldata continuityRoots
    ) external nonReentrant {
        (bool isNotReplay, bytes32 txKey) = _checkForReplay(chainKey, blockHeight, siblings);
        require(isNotReplay, "Transaction already processed");

        require(VERIFIER.verifyAndEmit(
            chainKey, blockHeight, encodedTransaction,
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings}),
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots})
        ), "Native verification failed");

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Transaction failed on source chain");

        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, TRANSFER_EVENT_SIGNATURE);
        require(logs.length > 0, "No Transfer events found");

        bool processed = false;
        address trustedVault = sourceVaults[chainKey];
        require(trustedVault != address(0), "Source chain not configured");

        for (uint i = 0; i < logs.length; i++) {
            address tokenAddress = logs[i].address_;
            
            // Check if the Token is whitelisted for this chain
            if (whitelistedSourceTokens[chainKey][tokenAddress]) {
                require(logs[i].topics.length == 3, "Invalid topics");
                address lender = address(uint160(uint256(logs[i].topics[1])));
                address toAddr = address(uint160(uint256(logs[i].topics[2])));
                
                // CRITICAL: Ensure funds were sent to OUR LiquidityVault, not just anywhere.
                if (toAddr == trustedVault) {
                    uint256 amount = abi.decode(logs[i].data, (uint256));
                    
                    Pool storage pool = pools[tokenAddress];
                    uint256 sharesToMint;
                    if (pool.totalShares == 0) {
                        sharesToMint = amount;
                    } else {
                        sharesToMint = (amount * pool.totalShares) / pool.totalLiquidity;
                    }
                    
                    pool.totalLiquidity += amount;
                    pool.totalShares += sharesToMint;
                    pool.tokenOnSource = tokenAddress;
                    
                    lpShares[lender][tokenAddress] += sharesToMint;
                    processed = true;
                    emit LiquidityAdded(lender, tokenAddress, amount);
                    
                    // We only process one valid liquidity event per tx to avoid complexity
                    break;
                }
            }
        }
        require(processed, "No valid deposit to LiquidityVault found");
        processedQueries[txKey] = true;
    }

    function _checkForReplay(uint64 chainKey, uint64 blockHeight, INativeQueryVerifier.MerkleProofEntry[] memory siblings) 
        internal view returns (bool, bytes32 txKey) 
    {
        uint256 transactionIndex = NativeQueryVerifierLib._calculateTransactionIndex(siblings);
        txKey = keccak256(abi.encodePacked(chainKey, blockHeight, transactionIndex));
        return (!processedQueries[txKey], txKey);
    }

    function getUserTotalCollateral(address user) public view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < whitelistedTokens.length; i++) {
            address token = whitelistedTokens[i];
            if (isTokenWhitelisted[token]) {
                total += getAssetBalance(user, token);
            }
        }
        return total;
    }

    /**
     * @dev Calculates the underlying asset balance for a user.
     */
    function getAssetBalance(address user, address token) public view returns (uint256) {
        Pool storage pool = pools[token];
        if (pool.totalShares == 0) return 0;
        return (lpShares[user][token] * pool.totalLiquidity) / pool.totalShares;
    }

    function requestWithdrawal(address tokenOnSource, uint256 amount, uint64 destChainId) external nonReentrant {
        Pool storage pool = pools[tokenOnSource];
        uint256 userBalance = getAssetBalance(msg.sender, tokenOnSource);
        require(userBalance >= amount, "Insufficient LP balance");

        // Calculate shares to burn
        uint256 sharesToBurn = (amount * pool.totalShares) / pool.totalLiquidity;
        
        lpShares[msg.sender][tokenOnSource] -= sharesToBurn;
        pool.totalShares -= sharesToBurn;
        pool.totalLiquidity -= amount;
        
        emit WithdrawalAuthorized(msg.sender, tokenOnSource, amount, withdrawalNonce, destChainId);
        withdrawalNonce++;
        emit LiquidityWithdrawn(msg.sender, tokenOnSource, amount);
    }

    function slashLiquidity(address user, address token, uint256 amount) external {
        require(msg.sender == loanEngine, "Only LoanEngine");
        Pool storage pool = pools[token];
        uint256 userBalance = getAssetBalance(user, token);
        uint256 slashAmount = amount > userBalance ? userBalance : amount;
        
        if (slashAmount > 0) {
            uint256 sharesToBurn = (slashAmount * pool.totalShares) / pool.totalLiquidity;
            lpShares[user][token] -= sharesToBurn;
            pool.totalShares -= sharesToBurn;
            pool.totalLiquidity -= slashAmount;
            emit LiquiditySlashed(user, token, slashAmount);
        }
    }

    function distributeInterest(address token, uint256 amount) external {
        require(msg.sender == loanEngine, "Only LoanEngine");
        pools[token].totalLiquidity += amount;
    }

    function getPoolLiquidity(address token) external view returns (uint256) {
        return pools[token].totalLiquidity;
    }
}
