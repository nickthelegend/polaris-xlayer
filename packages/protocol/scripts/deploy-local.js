const hre = require("hardhat");
const fs = require("fs");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("🚀 Deploying LOCALNET (Ganache) with account:", deployer.address);

    // ===========================================
    // 1. Spoke Logic (Liquidity & Tokens)
    // ===========================================
    console.log("\n📦 1. Deploying Assets & Vault...");

    // Deploy Mock Tokens
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();
    const usdcAddr = await usdc.getAddress();
    console.log(`   - Mock USDC: ${usdcAddr}`);

    const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
    await usdt.waitForDeployment();
    const usdtAddr = await usdt.getAddress();
    console.log(`   - Mock USDT: ${usdtAddr}`);

    // Deploy LiquidityVault
    const LiquidityVault = await hre.ethers.getContractFactory("LiquidityVault");
    const vault = await LiquidityVault.deploy(deployer.address);
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    console.log(`   - LiquidityVault: ${vaultAddr}`);

    // Dependencies
    await (await vault.setTokenWhitelist(usdcAddr, true)).wait();
    await (await vault.setTokenWhitelist(usdtAddr, true)).wait();
    await (await usdc.mint(deployer.address, hre.ethers.parseUnits("1000000", 6))).wait();
    await (await usdt.mint(deployer.address, hre.ethers.parseUnits("1000000", 6))).wait();

    // ===========================================
    // 2. Master Logic (Protocol Core)
    // ===========================================
    console.log("\n🧠 2. Deploying Protocol Core...");

    // Deploy Library
    const EvmV1Decoder = await hre.ethers.getContractFactory("EvmV1Decoder");
    const decoder = await EvmV1Decoder.deploy();
    await decoder.waitForDeployment();
    const decoderAddr = await decoder.getAddress();
    console.log(`   - EvmV1Decoder: ${decoderAddr}`);

    // Deploy Mock Verifier (Unlike Testnet, we don't have a real Precompile on Ganache)
    const MockVerifier = await hre.ethers.getContractFactory("MockNativeQueryVerifier");
    const verifier = await MockVerifier.deploy();
    await verifier.waitForDeployment();
    const verifierAddr = await verifier.getAddress();
    console.log(`   - MockVerifier: ${verifierAddr}`);

    // Deploy PoolManager
    const PoolManager = await hre.ethers.getContractFactory("PoolManager", {
        libraries: { EvmV1Decoder: decoderAddr }
    });
    const poolManager = await PoolManager.deploy(verifierAddr);
    await poolManager.waitForDeployment();
    const pmAddr = await poolManager.getAddress();
    console.log(`   - PoolManager: ${pmAddr}`);

    // Deploy ScoreManager
    const ScoreManager = await hre.ethers.getContractFactory("ScoreManager");
    const scoreManager = await ScoreManager.deploy(pmAddr);
    await scoreManager.waitForDeployment();
    const smAddr = await scoreManager.getAddress();
    console.log(`   - ScoreManager: ${smAddr}`);

    // Deploy LoanEngine
    const LoanEngine = await hre.ethers.getContractFactory("LoanEngine", {
        libraries: { EvmV1Decoder: decoderAddr }
    });
    const loanEngine = await LoanEngine.deploy(smAddr, pmAddr, verifierAddr);
    await loanEngine.waitForDeployment();
    const leAddr = await loanEngine.getAddress();
    console.log(`   - LoanEngine: ${leAddr}`);

    // ===========================================
    // 3. Configuration
    // ===========================================
    console.log("\n🔧 3. Configuring System...");

    // Link Contracts
    await (await scoreManager.transferOwnership(leAddr)).wait();
    await (await poolManager.setLoanEngine(leAddr)).wait();
    console.log("   - Ownership & Linking done");

    // Whitelist "Local" Spoke (Chain ID 1337)
    // We treat Ganache as both Master and Spoke 1
    const CHAIN_ID = 1337;
    console.log(`   - Configuring Chain ${CHAIN_ID} (Local)...`);

    // 1. Register USDC Source Params (Vault + Token + Whitelist)
    await (await poolManager.setSourceParams(CHAIN_ID, vaultAddr, usdcAddr, true)).wait();

    // 2. Register USDT Source Params
    await (await poolManager.setSourceParams(CHAIN_ID, vaultAddr, usdtAddr, true)).wait();

    // 3. Whitelist tokens for Global Collateral usage (Hub Logic)
    await (await poolManager.setWhitelistedToken(usdcAddr, true)).wait();
    await (await poolManager.setWhitelistedToken(usdtAddr, true)).wait();

    console.log("   - Local Vault & Tokens Configured via setSourceParams");

    // ===========================================
    // 4. Output
    // ===========================================
    const deploymentData = {
        GANACHE: {
            LIQUIDITY_VAULT: vaultAddr,
            USDC: usdcAddr,
            USDT: usdtAddr,
            POOL_MANAGER: pmAddr,
            LOAN_ENGINE: leAddr,
            SCORE_MANAGER: smAddr,
            VERIFIER: verifierAddr,
            CHAIN_ID: CHAIN_ID
        }
    };

    console.log("\n✅ Local Deployment Complete!");
    console.log(JSON.stringify(deploymentData, null, 2));

    fs.writeFileSync("deployments-local.json", JSON.stringify(deploymentData, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
