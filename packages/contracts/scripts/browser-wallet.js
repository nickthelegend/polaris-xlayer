/**
 * A deterministic wallet for driving the app in a real browser.
 *
 * The browser flow has to be exercised by something that actually signs, and
 * a key generated inside the page dies with the tab — along with any position
 * it opened. This one is derived from the deployer key, so the same address
 * comes back every run, and it is funded with gas, shares and stablecoin so
 * the whole lifecycle is reachable.
 *
 *   npx hardhat run scripts/browser-wallet.js --network xlayerTestnet
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", `polaris-${network.name}.json`), "utf8")
  );
  const [deployer] = await ethers.getSigners();
  const pk = ethers.keccak256(ethers.toUtf8Bytes(process.env.DEPLOYER_PRIVATE_KEY + ":polaris:browser-test"));
  const w = new ethers.Wallet(pk);

  const settled = async (tx) => {
    const r = await tx.wait();
    for (let i = 0; i < 40; i++) {
      if ((await ethers.provider.getBlockNumber()) >= r.blockNumber) return r;
      await new Promise((s) => setTimeout(s, 500));
    }
    return r;
  };

  const gas = ethers.parseEther("0.01");
  if ((await ethers.provider.getBalance(w.address)) < gas / 2n) {
    await settled(await deployer.sendTransaction({ to: w.address, value: gas }));
  }
  const stock = await ethers.getContractAt("TestnetStock", dep.contracts.stock);
  const stable = await ethers.getContractAt("MockUSDC", dep.contracts.stable);
  if ((await stock.balanceOf(w.address)) < ethers.parseUnits("10", 18)) {
    await settled(await stock.mint(w.address, ethers.parseUnits("25", 18)));
  }
  if ((await stable.balanceOf(w.address)) < ethers.parseUnits("300", 6)) {
    await settled(await stable.mint(w.address, ethers.parseUnits("1000", 6)));
  }

  console.log(`address    ${w.address}`);
  console.log(`gas        ${ethers.formatEther(await ethers.provider.getBalance(w.address))} OKB`);
  console.log(`shares     ${ethers.formatUnits(await stock.balanceOf(w.address), 18)}`);
  console.log(`stablecoin ${ethers.formatUnits(await stable.balanceOf(w.address), 6)}`);
  console.log(`\nPRIVATE_KEY=${w.privateKey}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
