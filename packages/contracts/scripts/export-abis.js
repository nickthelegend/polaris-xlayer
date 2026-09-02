/**
 * Freeze the ABIs the web app needs into one small file it owns.
 *
 * The app used to import straight out of Hardhat's artifacts directory. That
 * works locally and fails everywhere else: artifacts are build output, they
 * are gitignored, and shipping the whole directory to a deploy means hundreds
 * of files the app never reads. Five ABIs is a few hundred lines.
 *
 *   npx hardhat run scripts/export-abis.js
 */
const fs = require("fs");
const path = require("path");

const WANT = {
  PolarisEngine: "contracts/polaris/PolarisEngine.sol",
  StockPriceOracle: "contracts/polaris/StockPriceOracle.sol",
  LiquidityPool: "contracts/polaris/LiquidityPool.sol",
  TestnetStock: "contracts/polaris/TestnetStock.sol",
  MockUSDC: "contracts/MockUSDC.sol",
};

const out = {};
for (const [name, dir] of Object.entries(WANT)) {
  const f = path.join(__dirname, "..", "artifacts", dir, `${name}.json`);
  if (!fs.existsSync(f)) throw new Error(`no artifact for ${name} — run \`npx hardhat compile\` first`);
  out[name] = JSON.parse(fs.readFileSync(f, "utf8")).abi;
}

const dest = path.join(__dirname, "..", "..", "..", "apps", "core", "lib", "polaris-abis.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${dest}`);
for (const [n, abi] of Object.entries(out)) {
  console.log(`  ${n.padEnd(18)} ${abi.length} entries, ${abi.filter((x) => x.type === "error").length} custom errors`);
}
