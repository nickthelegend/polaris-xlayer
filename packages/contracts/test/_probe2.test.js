const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const usd = (n) => BigInt(Math.round(n * 1e8));
const s6 = (n) => BigInt(Math.round(n * 1e6));
const sh = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
const D7 = 7 * 86400, D14 = 14 * 86400;

async function setup() {
  const [owner, borrower, merchant, liquidator, funder, attacker] = await ethers.getSigners();
  const stock = await (await ethers.getContractFactory("TestnetStock")).deploy("t","tX",18,owner.address);
  const usdt = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const oracle = await (await ethers.getContractFactory("StockPriceOracle")).deploy(owner.address);
  const pool = await (await ethers.getContractFactory("LiquidityPool")).deploy(await usdt.getAddress(), owner.address);
  const engine = await (await ethers.getContractFactory("StocklineEngine")).deploy(
    await usdt.getAddress(), await oracle.getAddress(), await pool.getAddress(), owner.address);
  await pool.setEngine(await engine.getAddress());
  await engine.setAcceptedStock(await stock.getAddress(), true);
  await usdt.mint(funder.address, s6(1_000_000));
  await usdt.connect(funder).approve(await pool.getAddress(), ethers.MaxUint256);
  await pool.connect(funder).fund(s6(1_000_000));
  for (const a of [borrower, attacker]) {
    await stock.mint(a.address, sh(1000));
    await stock.connect(a).approve(await engine.getAddress(), ethers.MaxUint256);
  }
  for (const a of [borrower, liquidator, attacker]) {
    await usdt.mint(a.address, s6(100_000));
    await usdt.connect(a).approve(await engine.getAddress(), ethers.MaxUint256);
  }
  await oracle.postPrice(await stock.getAddress(), usd(220), await time.latest(), true, "x");
  return { owner, borrower, merchant, liquidator, funder, attacker, stock, usdt, oracle, pool, engine,
           S: await stock.getAddress() };
}

describe("PROBE2", () => {
  it("A: health at open at max LTV, default params, both tenors", async () => {
    const d = await setup();
    for (const [i,t] of [D7, D14].entries()) {
      const q = await d.engine.quote(d.S, sh(10), t);
      await d.engine.connect(d.borrower).openLoan(d.S, sh(10), d.merchant.address, ethers.id("a"+i), q.maxBorrow, t);
      const id = i;
      console.log(`   tenor=${t/86400}d HF=${ethers.formatUnits(await d.engine.healthFactor(id),18)} liq=${await d.engine.isLiquidatable(id)}`);
    }
  });

  it("B: setRiskParams within its own guard -> instantly liquidatable at open", async () => {
    const d = await setup();
    await d.engine.setRiskParams(4990, 1000, 5000, 500); // passes the guard: 4990 < 5000
    const q = await d.engine.quote(d.S, sh(10), D14);
    await d.engine.connect(d.borrower).openLoan(d.S, sh(10), d.merchant.address, ethers.id("b"), q.maxBorrow, D14);
    const hf = await d.engine.healthFactor(0);
    console.log(`   HF at open = ${ethers.formatUnits(hf,18)}  liquidatable=${await d.engine.isLiquidatable(0)}`);
    if (await d.engine.isLiquidatable(0)) {
      const before = await d.stock.balanceOf(d.borrower.address);
      const debt = await d.engine.amountOwed(0);
      await d.engine.connect(d.liquidator).liquidate(0);
      const seized = await d.stock.balanceOf(d.liquidator.address);
      const back = (await d.stock.balanceOf(d.borrower.address)) - before;
      console.log(`   SAME BLOCK liquidation: debt=${debt} seized=${ethers.formatUnits(seized,18)} returned=${ethers.formatUnits(back,18)}`);
      console.log(`   borrower lost ${ethers.formatUnits(sh(10)-back,18)} shares worth $${Number(ethers.formatUnits(sh(10)-back,18))*220}`);
    }
  });

  it("C: order-ref griefing burns a merchant order for dust", async () => {
    const d = await setup();
    const ref = ethers.id("INV-1001");
    // attacker front-runs with the smallest viable loan
    const dust = 20_000_000_000n; // 2e10 wei of an 18dp stock
    const q = await d.engine.quote(d.S, dust, D7);
    console.log(`   dust collateral value = ${q.collateralValue} (6dp units), maxBorrow=${q.maxBorrow}`);
    await d.engine.connect(d.attacker).openLoan(d.S, dust, d.merchant.address, ref, 1n, D7);
    console.log(`   attacker locked ${dust} wei of stock (=$${Number(ethers.formatUnits(dust,18))*220})`);
    await expect(
      d.engine.connect(d.borrower).openLoan(d.S, sh(10), d.merchant.address, ref, s6(700), D7)
    ).to.be.revertedWithCustomError(d.engine, "OrderAlreadyUsed");
    console.log("   real shopper's checkout for INV-1001 is permanently blocked");
  });

  it("D: repointing the engine strands every live loan's collateral", async () => {
    const d = await setup();
    await d.engine.connect(d.borrower).openLoan(d.S, sh(10), d.merchant.address, ethers.id("d"), s6(700), D7);
    const engine2 = await (await ethers.getContractFactory("StocklineEngine")).deploy(
      await d.usdt.getAddress(), await d.oracle.getAddress(), await d.pool.getAddress(), d.owner.address);
    await d.pool.setEngine(await engine2.getAddress());
    await expect(d.engine.connect(d.borrower).repay(0)).to.be.revertedWithCustomError(d.pool, "NotEngine");
    await expect(d.engine.connect(d.liquidator).liquidate(0)).to.be.reverted;
    console.log("   loan 0 can now be neither repaid nor liquidated; 10 shares stuck forever");
  });

  it("E: third-party funder has no claim; owner drains", async () => {
    const d = await setup();
    const before = await d.usdt.balanceOf(d.owner.address);
    await d.pool.withdraw(d.owner.address, await d.pool.available());
    console.log(`   owner took ${(await d.usdt.balanceOf(d.owner.address)) - before} units funded by a third party`);
  });

  it("F: liquidating an expired but perfectly healthy loan", async () => {
    const d = await setup();
    await d.engine.connect(d.borrower).openLoan(d.S, sh(10), d.merchant.address, ethers.id("f"), s6(700), D7);
    await time.increase(D7 + 1);
    await d.oracle.postPrice(d.S, usd(260), await time.latest(), true, "x"); // price ROSE
    console.log(`   HF=${ethers.formatUnits(await d.engine.healthFactor(0),18)} liq=${await d.engine.isLiquidatable(0)}`);
    const before = await d.stock.balanceOf(d.borrower.address);
    await d.engine.connect(d.liquidator).liquidate(0);
    const seized = await d.stock.balanceOf(d.liquidator.address);
    console.log(`   liquidator seized ${ethers.formatUnits(seized,18)} shares ($${(Number(ethers.formatUnits(seized,18))*260).toFixed(2)}) for $${Number(await d.engine.amountOwed(0))/1e6} of debt`);
    console.log(`   borrower got back ${ethers.formatUnits((await d.stock.balanceOf(d.borrower.address))-before,18)}`);
  });

  it("G: closed-market path — 4 day stale print, LTV vs real gap", async () => {
    const d = await setup();
    const friday = (await time.latest());
    await d.oracle.postPrice(d.S, usd(220), friday, false, "close");
    await time.increase(3 * 86400);
    const q = await d.engine.quote(d.S, sh(10), D7);
    console.log(`   3 days after the close, quote still works: ltv=${q.ltvBps} maxBorrow=${q.maxBorrow} price=${q.usdPerShare}`);
  });
});
