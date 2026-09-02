/**
 * Deploy Stockline.
 *
 * On a network where the real assets exist, pass them in and nothing is
 * invented:
 *   STOCK_TOKEN=0x...   an actual tokenized share (xStock or equivalent)
 *   STABLE_TOKEN=0x...  actual USDT0
 *
 * Where they do not exist — X Layer testnet, today — this deploys a clearly
 * labelled stand-in for each and says so in the output and in the deployment
 * record. Everything above the token layer is the same code either way.
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const usd = (n) => BigInt(Math.round(n * 1e8));

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`network   ${network.name} (chainId ${network.config.chainId})`);
  console.log(`deployer  ${deployer.address}`);
  console.log(`balance   ${ethers.formatEther(bal)}\n`);
  if (bal === 0n) throw new Error("deployer has no gas on this network");

  const standIns = [];

  // ── the two tokens ──────────────────────────────────────────────────────
  let stable = process.env.STABLE_TOKEN;
  if (!stable) {
    const c = await (await ethers.getContractFactory("MockUSDC")).deploy();
    await c.waitForDeployment();
    stable = await c.getAddress();
    standIns.push({ what: "stablecoin", address: stable, why: "USDT0 is not deployed on this network" });
    console.log(`stand-in stablecoin  ${stable}`);
  } else {
    console.log(`stablecoin (real)    ${stable}`);
  }

  let stock = process.env.STOCK_TOKEN;
  if (!stock) {
    const c = await (await ethers.getContractFactory("TestnetStock")).deploy(
      "Testnet Apple (NOT A SECURITY)", "tXAAPL", 18, deployer.address
    );
    await c.waitForDeployment();
    stock = await c.getAddress();
    standIns.push({ what: "tokenized share", address: stock, why: "xStocks are not issued on this network" });
    console.log(`stand-in stock       ${stock}`);
  } else {
    console.log(`stock (real)         ${stock}`);
  }

  // ── the protocol ────────────────────────────────────────────────────────
  const oracle = await (await ethers.getContractFactory("StockPriceOracle")).deploy(deployer.address);
  await oracle.waitForDeployment();
  console.log(`oracle               ${await oracle.getAddress()}`);

  const pool = await (await ethers.getContractFactory("LiquidityPool")).deploy(stable, deployer.address);
  await pool.waitForDeployment();
  console.log(`pool                 ${await pool.getAddress()}`);

  const engine = await (await ethers.getContractFactory("StocklineEngine")).deploy(
    stable, await oracle.getAddress(), await pool.getAddress(), deployer.address
  );
  await engine.waitForDeployment();
  console.log(`engine               ${await engine.getAddress()}\n`);

  await (await pool.setEngine(await engine.getAddress())).wait();

  // X Layer is an OP Stack L2 with one sequencer. Chainlink publishes an
  // uptime feed on mainnet; testnet has none, and address(0) correctly
  // disables the check rather than pretending to one.
  const SEQUENCER_FEED = {
    196: "0x45c2b8C204568A03Dc7A2E32B71D67Fe97F908A9",
  }[Number(network.config.chainId)];
  if (SEQUENCER_FEED) {
    await (await engine.setSequencerUptimeFeed(SEQUENCER_FEED, 3600)).wait();
    console.log(`sequencer uptime feed ${SEQUENCER_FEED} (1h grace)`);
  } else {
    console.log("no sequencer uptime feed on this network — liquidation guard disabled");
  }
  await (await engine.setAcceptedStock(stock, true)).wait();
  console.log("wired: pool -> engine, engine accepts the stock");

  // ── float, so a merchant can actually be paid ───────────────────────────
  const warehouse = BigInt(process.env.WAREHOUSE_UNITS || "100000000000"); // 100k at 6dp
  const stableC = await ethers.getContractAt("MockUSDC", stable);
  if (!process.env.STABLE_TOKEN) {
    await (await stableC.mint(deployer.address, warehouse)).wait();
  }
  const have = await stableC.balanceOf(deployer.address);
  const fund = have < warehouse ? have : warehouse;
  if (fund > 0n) {
    await (await stableC.approve(await pool.getAddress(), fund)).wait();
    await (await pool.fund(fund)).wait();
    console.log(`funded warehouse with ${fund} units`);
  } else {
    console.log("WARNING: pool has no float; no merchant can be paid yet");
  }

  // ── a first price, so the book has something to quote against ───────────
  const price = usd(Number(process.env.OPEN_PRICE || 220));
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await (await oracle.postPrice(stock, price, now, true, process.env.PRICE_SOURCE || "manual open")).wait();
  console.log(`posted price ${price} (1e8) for ${stock}`);

  const out = {
    network: network.name,
    chainId: Number(network.config.chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      stock,
      stable,
      oracle: await oracle.getAddress(),
      pool: await pool.getAddress(),
      engine: await engine.getAddress(),
    },
    risk: {
      maxLtvBps: Number(await engine.maxLtvBps()),
      closedMarketHaircutBps: Number(await engine.closedMarketHaircutBps()),
      liquidationThresholdBps: Number(await engine.liquidationThresholdBps()),
      liquidationBonusBps: Number(await engine.liquidationBonusBps()),
      originationFeeBps: Number(await engine.originationFeeBps()),
      interestAprBps: Number(await engine.interestAprBps()),
      minTenorDays: Number(await engine.minTenor()) / 86400,
      maxTenorDays: Number(await engine.maxTenor()) / 86400,
    },
    // Recorded rather than glossed over: anyone reading this deployment can
    // see exactly which pieces are real and which are standing in.
    standIns,
    sequencerUptimeFeed: SEQUENCER_FEED || null,
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `stockline-${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${file}`);
  if (standIns.length) {
    console.log("\nSTAND-INS IN THIS DEPLOYMENT:");
    for (const s of standIns) console.log(`  ${s.what}: ${s.address} — ${s.why}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
