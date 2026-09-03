/**
 * Everything that can be checked about an X Layer mainnet launch without
 * spending anything.
 *
 * A mainnet deployment costs real money, so it is not something an unattended
 * run should do. What it should do is make the decision a single informed
 * command rather than a leap: this reads mainnet, prices the deployment against
 * the current gas price, confirms the real USDT0 is what the docs claim, and
 * says plainly which parts of the product would still be standing in for
 * something.
 *
 *   npx hardhat run scripts/mainnet-preflight.js --network xlayer
 *
 * It only ever reads. Nothing here signs.
 */
const { ethers, network, artifacts } = require("hardhat");

/** USDT0 on X Layer mainnet. Six decimals, and the symbol carries U+20AE. */
const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";

/** Chainlink's sequencer uptime feed. Mainnet only; testnet has none. */
const SEQUENCER_FEED = "0x45c2b8C204568A03Dc7A2E32B71D67Fe97F908A9";

const CONTRACTS = [
  "contracts/polaris/StockPriceOracle.sol:StockPriceOracle",
  "contracts/polaris/LiquidityPool.sol:LiquidityPool",
  "contracts/polaris/PolarisEngine.sol:PolarisEngine",
];

const ok = (b) => (b ? "yes" : "NO");

async function main() {
  const net = await ethers.provider.getNetwork();
  console.log(`\nX Layer mainnet preflight — ${network.name}, chain ${net.chainId}\n`);
  if (Number(net.chainId) !== 196) {
    console.log(`  This is chain ${net.chainId}, not 196. Run it with --network xlayer.`);
    return;
  }

  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);
  const gasPrice = (await ethers.provider.getFeeData()).gasPrice ?? 0n;

  console.log("Deployer");
  console.log(`  address     ${signer.address}`);
  console.log(`  OKB         ${ethers.formatEther(balance)}`);
  console.log(`  gas price   ${ethers.formatUnits(gasPrice, "gwei")} gwei\n`);

  // Deployment cost, estimated from the actual bytecode rather than guessed.
  console.log("What deploying would cost");
  let total = 0n;
  for (const id of CONTRACTS) {
    const art = await artifacts.readArtifact(id.split(":")[1]);
    // 200 gas per byte is the intrinsic cost of the init code, plus a fixed
    // allowance for constructor execution and the 32k create overhead.
    const bytes = BigInt((art.bytecode.length - 2) / 2);
    const gas = bytes * 200n + 250_000n;
    const cost = gas * gasPrice;
    total += cost;
    console.log(`  ${id.split(":")[1].padEnd(18)} ~${gas} gas   ~${ethers.formatEther(cost)} OKB`);
  }
  console.log(`  ${"".padEnd(18)}  ${" ".repeat(10)}  ~${ethers.formatEther(total)} OKB total`);
  console.log(`  enough OKB? ${ok(balance > total)}\n`);

  // The stablecoin the pool would pay merchants in.
  console.log("USDT0");
  const erc20 = new ethers.Contract(
    USDT0,
    ["function symbol() view returns (string)", "function decimals() view returns (uint8)"],
    ethers.provider,
  );
  const code = await ethers.provider.getCode(USDT0);
  if (code === "0x") {
    console.log(`  ${USDT0} has no code. Stop and re-check the address.`);
  } else {
    const [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()]);
    console.log(`  address     ${USDT0}`);
    console.log(`  symbol      ${symbol}  (U+20AE present: ${ok(symbol.includes("₮"))})`);
    console.log(`  decimals    ${decimals}  (6 expected: ${ok(Number(decimals) === 6)})`);
  }

  console.log("\nSequencer uptime feed");
  const feedCode = await ethers.provider.getCode(SEQUENCER_FEED);
  console.log(`  ${SEQUENCER_FEED}`);
  console.log(`  deployed    ${ok(feedCode !== "0x")}  — the liquidation guard is live on mainnet, unlike testnet`);

  console.log("\nStill standing in, even here");
  console.log("  No real xStock exists on X Layer, so the collateral token would");
  console.log("  remain a testnet stand-in. That is the one thing a mainnet launch");
  console.log("  does not fix, and it should be said on the page rather than assumed.");

  console.log("\nWhat a launch needs, beyond gas");
  console.log("  The pool pays merchants from stablecoin it already holds, so it has");
  console.log("  to be funded with real USDT0 before the first checkout can settle.");

  console.log("\nTo go: STABLE_TOKEN=" + USDT0);
  console.log("       npx hardhat run scripts/deploy-polaris.js --network xlayer");
  console.log("       — spends real money. Nothing above did.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
