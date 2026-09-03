/**
 * Swap in an oracle that has the circuit breaker.
 *
 * The engine holds the oracle behind `setOracle`, so the mark can be replaced
 * without redeploying the engine or touching a single open position. The order
 * matters: deploy, seed with the current print, authorise the relayer, and only
 * then repoint — so the engine never sees an oracle with no price in it.
 *
 *   npx hardhat run scripts/upgrade-oracle.js --network xlayerTestnet
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const RELAYER = "0xb51756B8Ee57Cc622669E3B3EF67FA305821Bf56"; // the deployer, which the Railway relayer signs as

async function main() {
  const file = path.join(__dirname, "..", "deployments", `polaris-${network.name}.json`);
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const [signer] = await ethers.getSigners();
  console.log(`signer ${signer.address}\n`);

  const old = await ethers.getContractAt("StockPriceOracle", d.contracts.oracle);
  const engine = await ethers.getContractAt("PolarisEngine", d.contracts.engine);

  const [price, printedAt, marketOpen] = await old.peek(d.contracts.stock);
  const source = await old.sourceOf(d.contracts.stock);
  console.log(`carrying over $${Number(price) / 1e8} (${source}), printed ${printedAt}`);
  if (price === 0n) throw new Error("the old oracle has no price to carry over");

  const next = await (await ethers.getContractFactory("StockPriceOracle")).deploy(signer.address);
  await next.waitForDeployment();
  const addr = await next.getAddress();
  console.log(`new oracle ${addr}`);

  // Seed before wiring, so the engine is never pointed at an empty oracle.
  await (await next.postPrice(d.contracts.stock, price, printedAt, marketOpen, source)).wait();
  console.log("seeded with the current print");

  if (RELAYER.toLowerCase() !== signer.address.toLowerCase()) {
    await (await next.setRelayer(RELAYER, true)).wait();
    console.log(`relayer ${RELAYER} authorised`);
  } else {
    console.log("relayer is the deployer, already authorised by the constructor");
  }

  await (await engine.setOracle(addr)).wait();
  console.log("engine repointed");

  // X Layer serves pre-transaction state for a moment after a receipt.
  await new Promise((r) => setTimeout(r, 6000));
  const wired = await engine.oracle();
  if (wired.toLowerCase() !== addr.toLowerCase()) throw new Error(`engine still points at ${wired}`);
  const [p2] = await next.peek(d.contracts.stock);
  console.log(`\nengine.oracle() == ${wired}`);
  console.log(`new oracle price  $${Number(p2) / 1e8}`);
  console.log(`maxDeviationBps   ${await next.maxDeviationBps()}`);

  d.contracts.oraclePrevious = d.contracts.oracle;
  d.contracts.oracle = addr;
  fs.writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
  console.log(`\ndeployment record updated`);
}

main().catch((e) => { console.error(e); process.exit(1); });
