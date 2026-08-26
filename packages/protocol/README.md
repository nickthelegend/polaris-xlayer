# Polaris Protocol

**Cross-chain, credit-score-based lending and BNPL, settled on Creditcoin with trustless proofs of source-chain events.**

## Overview

Polaris Protocol is a hub-and-spoke DeFi credit protocol. Liquidity is deposited as stablecoins (USDC / USDT) into lightweight `LiquidityVault` contracts on "spoke" chains (Sepolia, Base Sepolia, Hedera, Avalanche Fuji, Monad, Cronos), while all credit logic — pools, loans, credit scores and repayments — lives on a "hub" deployed to Creditcoin.

Instead of a trusted bridge, the hub learns about spoke-chain activity by verifying the source transactions directly: it consumes Creditcoin's Native Query Verifier precompile (CCNext prover) to validate Merkle + continuity proofs of specific events (`LiquidityDeposited`, ERC-20 `Transfer`, loan `Repay`). This lets the protocol credit deposits, register repayments and update credit scores based on cryptographically proven events rather than an off-chain oracle it has to trust. A signature-based "reverse bridge" (EIP-712 validator signatures) authorizes releasing funds back out on the spoke chains.

The result is an undercollateralized / Buy-Now-Pay-Later credit line: users build a FICO-style score (300–850) through on-chain repayment behaviour, and merchants can be paid directly from a user's credit line.

## Features

- **Hub-and-spoke architecture** — credit logic on a Creditcoin hub; `LiquidityVault` deposit contracts on multiple EVM spoke chains.
- **Proof-verified cross-chain state** — `PoolManager` and `LoanEngine` ingest source-chain events through the Native Query Verifier precompile (`0x…0FD2`) using Merkle and continuity proofs, guarding against replay via a processed-query registry.
- **Credit scoring** — `ScoreManager` maintains dynamic per-user scores (300–850) that adjust with repayment behaviour and drive borrowing limits.
- **Undercollateralized loans / BNPL** — `LoanEngine` issues loans (10% APR, 20% protocol-fee split) tracked by proven repayment events; `MerchantRouter` lets customers pay merchants directly against their credit line.
- **External credit attestations** — `CreditOracle` stores signed attestations of positions on other protocols (Aave, Morpho, Compound) to compute global credit limits.
- **Reverse-bridge withdrawals** — EIP-712 validator signatures authorize releasing locked stablecoins from spoke vaults.
- **Insurance & protocol treasury** — `InsurancePool` (staked CTC) buffers defaults; `ProtocolFunds` accounts for collected fees.
- **Off-chain relayer** — a viem-based bridge daemon / validator (`scripts/bridge`) watches vaults and signs withdrawal authorizations; Supabase is used for indexing.

## Tech Stack

- **Solidity** 0.8.20 / 0.8.23 (`viaIR`, optimizer enabled)
- **Hardhat** + `@nomicfoundation/hardhat-toolbox`
- **OpenZeppelin Contracts** v5 (Ownable, ReentrancyGuard, ECDSA, EIP712, SafeERC20)
- **ethers.js** v6 and **viem** v2
- **TypeScript** / **ts-node** for the bridge relayer & validator
- **Creditcoin CCNext** Native Query Verifier (prover precompile)
- **Supabase** (`@supabase/supabase-js`) + axios for off-chain indexing/tooling

## Getting Started

```bash
# Clone and install
git clone https://github.com/nickthelegend/polaris-protocol.git
cd polaris-protocol
npm install

# Provide a deployer key + any RPC secrets
cp .env.example .env   # if present; otherwise create .env with PRIVATE_KEY=0x...

# Compile the contracts
npx hardhat compile

# Run the test suite
npx hardhat test

# Deploy the hub (example: Creditcoin USC testnet) and a spoke vault
npx hardhat run scripts/deploy-master.js --network uscTestnetV2
npx hardhat run scripts/deploy-spoke.js  --network sepolia

# Walk through an end-to-end deposit -> proof -> loan demo
npx hardhat run scripts/demo_flow.js --network localhost
```

Configured networks (see `hardhat.config.js`): `hardhat`, `ganache`, `ctcTestnet`, `uscTestnetV2`, `sepolia`, `baseSepolia`, `fuji`, `monadTestnet`, `cronosTestnet`. A `PRIVATE_KEY` in `.env` is required for the live testnets.

## Project Structure

```
contracts/
  CreditOracle.sol      # Signed attestations of external (Aave/Morpho/Compound) positions
  CreditVault.sol       # Per-user credit limit / LTV accounting
  ScoreManager.sol      # FICO-style credit scores (300-850)
  PoolManager.sol       # Liquidity pools; ingests proven source-chain deposits/withdrawals
  LoanEngine.sol        # Loan issuance, interest, proof-verified repayments, defaults
  MerchantRouter.sol    # BNPL: pay merchants directly from a credit line
  LiquidityVault.sol    # Spoke-chain deposit vault + EIP-712 reverse-bridge release
  InsurancePool.sol     # Staked-CTC buffer for defaults
  ProtocolFunds.sol     # Protocol fee accounting
  interfaces/           # Native Query Verifier, Creditcoin prover, USC oracle, EVM decoder
  mocks/                # MockERC20, mock verifier / oracle relayer for local testing
scripts/                # Deploy, configure, fund, verify, and demo scripts
  bridge/               # viem-based relayer, validator & bridge daemon (TypeScript)
test/                   # Polaris.test.js, PolarisFull.test.js, V2Migration.test.js
hardhat.config.js       # Multi-chain network + compiler config
deployments*.json       # Recorded hub/spoke deployment addresses
```

---

Built by [nickthelegend](https://github.com/nickthelegend) · [nickthelegend.tech](https://nickthelegend.tech)
