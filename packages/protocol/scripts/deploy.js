/**
 * Deploy the protocol stack.
 *
 * This script had drifted badly from the contracts it deploys: `LiquidityVault`
 * takes a validator, `LoanEngine` takes four addresses rather than two, and
 * `MerchantRouter` takes the loan engine as well as the pool — so running it
 * failed at the third contract with "incorrect number of arguments to
 * constructor". It also printed the addresses and nothing else, which is how
 * merchant-web ended up with a different chain's contracts hardcoded into
 * lib/constants.ts.
 *
 *   npx hardhat run scripts/deploy.js --network xlayerTestnet
 *
 * Writes deployments/<network>.json, which is what the web surfaces read.
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * PoolManager and LoanEngine take a verifier address and fall back to their own
 * NativeQueryVerifier when given the zero address. On a network with no native
 * query precompile that fallback is the only correct choice.
 */
const NO_VERIFIER = "0x0000000000000000000000000000000000000000";

async function deploy(name, ...args) {
  const factory = await hre.ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`  ${name.padEnd(18)} ${address}`);
  return { contract, address };
}

/** Same as `deploy`, for a contract that links a library. */
async function deployLinked(name, libraries, ...args) {
  const factory = await hre.ethers.getContractFactory(name, { libraries });
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`  ${name.padEnd(18)} ${address}`);
  return { contract, address };
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  console.log(`\ndeploying to ${hre.network.name} (chain ${net.chainId})`);
  console.log(`deployer ${deployer.address}\n`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  if (balance === 0n) throw new Error("deployer has no gas on this network");

  // Stand-in tokens: no canonical stablecoin for this protocol exists on a
  // testnet, and the record below says so rather than leaving it to be assumed.
  const usdc = await deploy("MockERC20", "USD Coin", "USDC", 18);
  const usdt = await deploy("MockERC20", "Tether", "USDT", 18);

  const oracle = await deploy("CreditOracle", deployer.address);

  // PoolManager and LoanEngine both link EvmV1Decoder, so it has to exist on
  // chain before either can be deployed.
  const decoder = await deploy("EvmV1Decoder");
  const libraries = { "contracts/interfaces/EvmV1Decoder.sol:EvmV1Decoder": decoder.address };

  const poolManager = await deployLinked("PoolManager", libraries, NO_VERIFIER);
  const scoreManager = await deploy("ScoreManager", poolManager.address, oracle.address);
  const protocolFunds = await deploy("ProtocolFunds", deployer.address);
  const creditVault = await deploy("CreditVault");
  const vault = await deploy("LiquidityVault", deployer.address);
  const loanEngine = await deployLinked(
    "LoanEngine",
    libraries,
    scoreManager.address,
    poolManager.address,
    NO_VERIFIER,
    protocolFunds.address,
  );
  const merchantRouter = await deploy("MerchantRouter", poolManager.address, loanEngine.address);
  const insurancePool = await deploy("InsurancePool", usdc.address);

  const record = {
    network: hre.network.name,
    chainId: Number(net.chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      USDC: usdc.address,
      USDT: usdt.address,
      EVM_V1_DECODER: decoder.address,
      CREDIT_ORACLE: oracle.address,
      POOL_MANAGER: poolManager.address,
      SCORE_MANAGER: scoreManager.address,
      PROTOCOL_FUNDS: protocolFunds.address,
      CREDIT_VAULT: creditVault.address,
      LIQUIDITY_VAULT: vault.address,
      LOAN_ENGINE: loanEngine.address,
      MERCHANT_ROUTER: merchantRouter.address,
      INSURANCE_POOL: insurancePool.address,
    },
    standIns: [
      { what: "USDC and USDT", why: "no canonical stablecoin for this protocol exists on this network" },
      { what: "credit oracle attester", why: "the deployer attests, because no attester service runs on a testnet" },
      { what: "query verifier", why: "no native query precompile on this network, so the built-in fallback is used" },
    ],
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hre.network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  console.log(`\nrecorded -> packages/protocol/deployments/${hre.network.name}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
