const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const BPS = 10_000n;
const usd = (n) => BigInt(Math.round(n * 1e8));
const stable6 = (n) => BigInt(Math.round(n * 1e6));

async function deployAll(stockDecimals) {
  const [owner, borrower, merchant, liquidator, funder] = await ethers.getSigners();
  const stock = await (await ethers.getContractFactory("TestnetStock")).deploy("t", "tX", stockDecimals, owner.address);
  const usdt = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const oracle = await (await ethers.getContractFactory("StockPriceOracle")).deploy(owner.address);
  const pool = await (await ethers.getContractFactory("LiquidityPool")).deploy(await usdt.getAddress(), owner.address);
  const engine = await (await ethers.getContractFactory("StocklineEngine")).deploy(
    await usdt.getAddress(), await oracle.getAddress(), await pool.getAddress(), owner.address);
  await pool.setEngine(await engine.getAddress());
  await engine.setAcceptedStock(await stock.getAddress(), true);
  await usdt.mint(funder.address, stable6(5_000_000));
  await usdt.connect(funder).approve(await pool.getAddress(), ethers.MaxUint256);
  await pool.connect(funder).fund(stable6(5_000_000));
  const unit = 10n ** BigInt(stockDecimals);
  await stock.mint(borrower.address, 1000n * unit);
  await stock.connect(borrower).approve(await engine.getAddress(), ethers.MaxUint256);
  await usdt.mint(borrower.address, stable6(1_000_000));
  await usdt.connect(borrower).approve(await engine.getAddress(), ethers.MaxUint256);
  await usdt.mint(liquidator.address, stable6(1_000_000));
  await usdt.connect(liquidator).approve(await engine.getAddress(), ethers.MaxUint256);
  return { owner, borrower, merchant, liquidator, funder, stock, usdt, oracle, pool, engine, unit };
}

describe("PROBE", () => {
  it("fuzz: share + stable conservation across decimals, prices, paths", async () => {
    for (const sd of [6, 8, 18]) {
      const d = await deployAll(sd);
      const S = await d.stock.getAddress();
      let seed = 12345;
      const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };

      let ref = 0;
      for (let i = 0; i < 40; i++) {
        const price = usd(50 + rnd(400));
        await d.oracle.postPrice(S, price, await time.latest(), true, "x");
        const sh = BigInt(1 + rnd(20)) * d.unit / 4n;
        const q = await d.engine.quote(S, sh, 7 * 86400);
        if (q.maxBorrow === 0n) continue;
        const borrow = q.maxBorrow - BigInt(rnd(Number(q.maxBorrow > 1000n ? 1000n : 1n)));
        if (borrow === 0n) continue;
        const id = Number(await d.engine.loanCount());
        await d.engine.connect(d.borrower).openLoan(S, sh, d.merchant.address, ethers.id("r" + (ref++)), borrow, 7 * 86400);

        // conservation check: lockedOf == engine balance
        expect(await d.engine.lockedOf(S)).to.equal(await d.stock.balanceOf(await d.engine.getAddress()),
          `lockedOf mismatch sd=${sd} i=${i}`);

        const path = rnd(3);
        if (path === 0) {
          await d.engine.connect(d.borrower).repay(id);
        } else {
          const newPrice = usd(1 + rnd(400));
          await d.oracle.postPrice(S, newPrice, await time.latest(), true, "x");
          const l = await d.engine.getLoan(id);
          if (await d.engine.isLiquidatable(id)) {
            const bBefore = await d.stock.balanceOf(d.borrower.address);
            const qBefore = await d.stock.balanceOf(d.liquidator.address);
            await d.engine.connect(d.liquidator).liquidate(id);
            const seized = (await d.stock.balanceOf(d.liquidator.address)) - qBefore;
            const returned = (await d.stock.balanceOf(d.borrower.address)) - bBefore;
            expect(seized + returned).to.equal(l.shares, `seize+return != shares sd=${sd} i=${i}`);
          }
        }
        expect(await d.engine.lockedOf(S)).to.equal(await d.stock.balanceOf(await d.engine.getAddress()),
          `lockedOf mismatch post sd=${sd} i=${i}`);

        // outstanding == sum of active principals
        let sum = 0n;
        const n = Number(await d.engine.loanCount());
        for (let k = 0; k < n; k++) {
          const lk = await d.engine.getLoan(k);
          if (Number(lk.status) === 1) sum += lk.principal;
        }
        expect(await d.pool.outstanding()).to.equal(sum, `outstanding drift sd=${sd} i=${i}`);
      }
      // global stable conservation
      const total = (await d.usdt.balanceOf(await d.pool.getAddress()))
        + (await d.usdt.balanceOf(d.borrower.address))
        + (await d.usdt.balanceOf(d.liquidator.address))
        + (await d.usdt.balanceOf(d.merchant.address))
        + (await d.usdt.balanceOf(d.funder.address))
        + (await d.usdt.balanceOf(d.owner.address))
        + (await d.usdt.balanceOf(await d.engine.getAddress()));
      expect(await d.usdt.totalSupply()).to.equal(total, `stable leak sd=${sd}`);
      expect(await d.usdt.balanceOf(await d.engine.getAddress())).to.equal(0n);
      console.log(`   sd=${sd}: ok, loans=${await d.engine.loanCount()}`);
    }
  }).timeout(600000);
});
