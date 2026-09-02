const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Stockline: borrow stablecoin against tokenized equity to pay a merchant.
 *
 * The decimals here are deliberately all different — the stock is 18, the
 * stablecoin is 6, the oracle is 8 — because that is the shape of the real
 * deployment and conflating any two of them misprices the book by orders of
 * magnitude. Every expected value below is computed from first principles in
 * the test rather than copied from a run, so a regression in the maths fails
 * loudly instead of re-baselining itself.
 */
const E8 = 10n ** 8n;
const E18 = 10n ** 18n;
const E6 = 10n ** 6n;
const BPS = 10_000n;

const usd = (n) => BigInt(Math.round(n * 1e8)); // oracle scale
const stable = (n) => BigInt(Math.round(n * 1e6));
const shares = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 12n; // 18dp, 6dp of precision

describe("Stockline", () => {
  let owner, borrower, merchant, liquidator, funder;
  let stock, usdt, oracle, pool, engine;

  const PRICE = usd(220); // XAAPL at $220
  const TENOR = 7 * 24 * 60 * 60;

  async function post(price = PRICE, open = true) {
    await oracle.postPrice(await stock.getAddress(), price, await time.latest(), open, "NASDAQ last");
  }

  beforeEach(async () => {
    [owner, borrower, merchant, liquidator, funder] = await ethers.getSigners();

    stock = await (await ethers.getContractFactory("TestnetStock")).deploy(
      "Testnet Apple (NOT A SECURITY)", "tXAAPL", 18, owner.address
    );
    usdt = await (await ethers.getContractFactory("MockUSDC")).deploy();
    oracle = await (await ethers.getContractFactory("StockPriceOracle")).deploy(owner.address);
    pool = await (await ethers.getContractFactory("LiquidityPool")).deploy(await usdt.getAddress(), owner.address);
    engine = await (await ethers.getContractFactory("StocklineEngine")).deploy(
      await usdt.getAddress(), await oracle.getAddress(), await pool.getAddress(), owner.address
    );

    await pool.setEngine(await engine.getAddress());
    await engine.setAcceptedStock(await stock.getAddress(), true);
    await post();

    // A warehouse with real stablecoin in it, before any loan opens.
    await usdt.mint(funder.address, stable(1_000_000));
    await usdt.connect(funder).approve(await pool.getAddress(), stable(1_000_000));
    await pool.connect(funder).fund(stable(1_000_000));

    await stock.mint(borrower.address, shares(100));
    await stock.connect(borrower).approve(await engine.getAddress(), ethers.MaxUint256);
    await usdt.mint(borrower.address, stable(10_000));
    await usdt.connect(borrower).approve(await engine.getAddress(), ethers.MaxUint256);
    await usdt.mint(liquidator.address, stable(100_000));
    await usdt.connect(liquidator).approve(await engine.getAddress(), ethers.MaxUint256);
  });

  it("values collateral across three different decimal scales", async () => {
    // 10 shares at $220 = $2,200, expressed in 6dp stablecoin units.
    const v = await engine.collateralValueOf(await stock.getAddress(), shares(10), PRICE);
    expect(v).to.equal(stable(2_200));
  });

  it("caps the loan at 35% of collateral while the market is open", async () => {
    const q = await engine.quote(await stock.getAddress(), shares(10), TENOR);
    expect(q.collateralValue).to.equal(stable(2_200));
    expect(q.ltvBps).to.equal(3_500n);
    expect(q.maxBorrow).to.equal((stable(2_200) * 3_500n) / BPS); // $770
    expect(q.marketOpen).to.equal(true);
  });

  it("haircuts the ceiling further when the venue was shut", async () => {
    await post(PRICE, false);
    const q = await engine.quote(await stock.getAddress(), shares(10), TENOR);
    // 35% * (1 - 10%) = 31.5%
    expect(q.ltvBps).to.equal(3_150n);
    expect(q.maxBorrow).to.equal((stable(2_200) * 3_150n) / BPS);
  });

  it("pays the merchant immediately, from the pool, and locks the shares", async () => {
    const borrow = stable(700);
    const before = await usdt.balanceOf(merchant.address);

    await engine.connect(borrower).openLoan(
      await stock.getAddress(), shares(10), merchant.address, ethers.id("order-1"), borrow, TENOR
    );

    expect(await usdt.balanceOf(merchant.address)).to.equal(before + borrow);
    expect(await stock.balanceOf(await engine.getAddress())).to.equal(shares(10));
    expect(await stock.balanceOf(borrower.address)).to.equal(shares(90));
    expect(await pool.outstanding()).to.equal(borrow);

    const l = await engine.getLoan(0);
    expect(l.borrower).to.equal(borrower.address);
    expect(l.merchant).to.equal(merchant.address);
    expect(l.principal).to.equal(borrow);
    expect(l.openPrice).to.equal(PRICE);
    expect(l.status).to.equal(1n); // Active
  });

  it("refuses a loan above the ceiling", async () => {
    const q = await engine.quote(await stock.getAddress(), shares(10), TENOR);
    await expect(
      engine.connect(borrower).openLoan(
        await stock.getAddress(), shares(10), merchant.address, ethers.id("o"), q.maxBorrow + 1n, TENOR
      )
    ).to.be.revertedWithCustomError(engine, "ExceedsMaxLtv");
  });

  it("refuses a tenor outside 7-14 days", async () => {
    for (const t of [6 * 86400, 15 * 86400]) {
      await expect(
        engine.connect(borrower).openLoan(
          await stock.getAddress(), shares(10), merchant.address, ethers.id("t" + t), stable(100), t
        )
      ).to.be.revertedWithCustomError(engine, "TenorOutOfRange");
    }
  });

  it("makes a retried checkout idempotent on (merchant, orderRef)", async () => {
    const ref = ethers.id("basket-42");
    await engine.connect(borrower).openLoan(
      await stock.getAddress(), shares(10), merchant.address, ref, stable(700), TENOR
    );
    await expect(
      engine.connect(borrower).openLoan(
        await stock.getAddress(), shares(10), merchant.address, ref, stable(700), TENOR
      )
    ).to.be.revertedWithCustomError(engine, "OrderAlreadyUsed");

    // The same reference under a different merchant is a different order.
    await expect(
      engine.connect(borrower).openLoan(
        await stock.getAddress(), shares(10), liquidator.address, ref, stable(700), TENOR
      )
    ).to.not.be.reverted;
  });

  it("charges origination plus interest only for the tenor borrowed", async () => {
    const p = stable(700);
    const week = await engine.feeFor(p, TENOR);
    const fortnight = await engine.feeFor(p, 14 * 86400);
    const origination = (p * 100n) / BPS;
    const weekInterest = (p * 1_200n * BigInt(TENOR)) / (BPS * 365n * 86400n);
    expect(week).to.equal(origination + weekInterest);
    // Twice the float, twice the interest — the origination part does not
    // double. Integer division can leave a single unit either way.
    expect(fortnight - origination).to.be.closeTo(2n * weekInterest, 1n);
  });

  it("returns every share on repayment and clears the pool's book", async () => {
    const borrow = stable(700);
    await engine.connect(borrower).openLoan(
      await stock.getAddress(), shares(10), merchant.address, ethers.id("r"), borrow, TENOR
    );
    const owed = await engine.amountOwed(0);
    expect(owed).to.equal(borrow + (await engine.feeFor(borrow, TENOR)));

    await engine.connect(borrower).repay(0);

    expect(await stock.balanceOf(borrower.address)).to.equal(shares(100));
    expect(await stock.balanceOf(await engine.getAddress())).to.equal(0n);
    expect(await pool.outstanding()).to.equal(0n);
    expect(await pool.earned()).to.equal(owed - borrow);
    expect((await engine.getLoan(0)).status).to.equal(2n); // Repaid
  });

  it("only the borrower can repay, and only once", async () => {
    await engine.connect(borrower).openLoan(
      await stock.getAddress(), shares(10), merchant.address, ethers.id("x"), stable(700), TENOR
    );
    await expect(engine.connect(liquidator).repay(0)).to.be.revertedWithCustomError(engine, "NotBorrower");
    await engine.connect(borrower).repay(0);
    await expect(engine.connect(borrower).repay(0)).to.be.revertedWithCustomError(engine, "NotActive");
  });

  it("is healthy at open and not liquidatable", async () => {
    await engine.connect(borrower).openLoan(
      await stock.getAddress(), shares(10), merchant.address, ethers.id("h"), stable(700), TENOR
    );
    // debt 707ish against $2200 collateral at a 50% threshold -> HF ~1.55
    expect(await engine.healthFactor(0)).to.be.greaterThan(10n ** 18n);
    expect(await engine.isLiquidatable(0)).to.equal(false);
  });

  it("becomes liquidatable when the price falls far enough", async () => {
    await engine.connect(borrower).openLoan(
      await stock.getAddress(), shares(10), merchant.address, ethers.id("d"), stable(700), TENOR
    );
    await post(usd(220 * 0.8)); // the demo's "price -20%" button
    expect(await engine.isLiquidatable(0)).to.equal(false); // still covered
    await post(usd(130));
    expect(await engine.healthFactor(0)).to.be.lessThan(10n ** 18n);
    expect(await engine.isLiquidatable(0)).to.equal(true);
  });

  it("becomes liquidatable when the tenor runs out, price regardless", async () => {
    await engine.connect(borrower).openLoan(
      await stock.getAddress(), shares(10), merchant.address, ethers.id("late"), stable(700), TENOR
    );
    await time.increase(TENOR + 1);
    await post(); // fresh, healthy price
    expect(await engine.isLiquidatable(0)).to.equal(true);
  });

  it("liquidation sells only what is needed and returns the rest", async () => {
    const borrow = stable(700);
    await engine.connect(borrower).openLoan(
      await stock.getAddress(), shares(10), merchant.address, ethers.id("liq"), borrow, TENOR
    );
    const debt = await engine.amountOwed(0);
    await post(usd(130));

    const borrowerBefore = await stock.balanceOf(borrower.address);
    await engine.connect(liquidator).liquidate(0);

    const seized = await stock.balanceOf(liquidator.address);
    const returned = (await stock.balanceOf(borrower.address)) - borrowerBefore;

    // Every share is accounted for: seized + returned == locked.
    expect(seized + returned).to.equal(shares(10));
    // The borrower keeps a real remainder — this is the product's whole point.
    expect(returned).to.be.greaterThan(0n);
    // The liquidator's take is the debt plus the 5% bonus, priced at $130.
    const expectSeize = (debt * (BPS + 500n) * E18 * E8) / (BPS * usd(130) * E6);
    expect(seized).to.be.closeTo(expectSeize, expectSeize / 10_000n);

    expect((await engine.getLoan(0)).status).to.equal(3n); // Liquidated
    expect(await pool.outstanding()).to.equal(0n);
  });

  it("takes all collateral and no more when the position is underwater", async () => {
    await engine.connect(borrower).openLoan(
      await stock.getAddress(), shares(10), merchant.address, ethers.id("under"), stable(700), TENOR
    );
    await post(usd(50)); // $500 of collateral against ~$707 of debt
    const before = await stock.balanceOf(borrower.address);
    await engine.connect(liquidator).liquidate(0);
    expect(await stock.balanceOf(liquidator.address)).to.equal(shares(10));
    // The borrower loses the position but is never chased for the shortfall.
    expect(await stock.balanceOf(borrower.address)).to.equal(before);
  });

  it("refuses to liquidate a healthy loan", async () => {
    await engine.connect(borrower).openLoan(
      await stock.getAddress(), shares(10), merchant.address, ethers.id("ok"), stable(700), TENOR
    );
    await expect(engine.connect(liquidator).liquidate(0)).to.be.revertedWithCustomError(engine, "NotLiquidatable");
  });

  it("refuses a stale price rather than lending against it", async () => {
    await time.increase(20 * 60);
    await expect(
      engine.connect(borrower).openLoan(
        await stock.getAddress(), shares(10), merchant.address, ethers.id("s"), stable(700), TENOR
      )
    ).to.be.revertedWithCustomError(oracle, "StalePrice");
  });

  it("refuses a stock nobody accepted", async () => {
    const other = await (await ethers.getContractFactory("TestnetStock")).deploy("x", "x", 18, owner.address);
    await expect(
      engine.connect(borrower).openLoan(
        await other.getAddress(), shares(1), merchant.address, ethers.id("n"), stable(1), TENOR
      )
    ).to.be.revertedWithCustomError(engine, "StockNotAccepted");
  });

  it("will not let the owner withdraw float that is out on loan", async () => {
    await engine.connect(borrower).openLoan(
      await stock.getAddress(), shares(10), merchant.address, ethers.id("w"), stable(700), TENOR
    );
    const free = await pool.available();
    await expect(pool.withdraw(owner.address, free + 1n)).to.be.revertedWithCustomError(pool, "InsufficientLiquidity");
    await expect(pool.withdraw(owner.address, free)).to.not.be.reverted;
  });

  it("rejects risk parameters that would make every loan instantly liquidatable", async () => {
    await expect(engine.setRiskParams(6_000, 1_000, 5_000, 500)).to.be.revertedWithCustomError(engine, "BadParam");
    await expect(engine.setRiskParams(3_500, 1_000, 5_000, 500)).to.not.be.reverted;
  });

  it("refuses a price printed in the future", async () => {
    const future = (await time.latest()) + 3600;
    await expect(
      oracle.postPrice(await stock.getAddress(), PRICE, future, true, "x")
    ).to.be.revertedWithCustomError(oracle, "PriceInFuture");
  });
});

describe("Stockline — staleness across a market close", () => {
  let owner, borrower, merchant, funder;
  let stock, usdt, oracle, pool, engine;
  const usd = (n) => BigInt(Math.round(n * 1e8));
  const stable = (n) => BigInt(Math.round(n * 1e6));
  const shares = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
  const TENOR = 7 * 24 * 60 * 60;

  beforeEach(async () => {
    [owner, borrower, merchant, funder] = await ethers.getSigners();
    stock = await (await ethers.getContractFactory("TestnetStock")).deploy("t", "tXAAPL", 18, owner.address);
    usdt = await (await ethers.getContractFactory("MockUSDC")).deploy();
    oracle = await (await ethers.getContractFactory("StockPriceOracle")).deploy(owner.address);
    pool = await (await ethers.getContractFactory("LiquidityPool")).deploy(await usdt.getAddress(), owner.address);
    engine = await (await ethers.getContractFactory("StocklineEngine")).deploy(
      await usdt.getAddress(), await oracle.getAddress(), await pool.getAddress(), owner.address
    );
    await pool.setEngine(await engine.getAddress());
    await engine.setAcceptedStock(await stock.getAddress(), true);
    await usdt.mint(funder.address, stable(1_000_000));
    await usdt.connect(funder).approve(await pool.getAddress(), stable(1_000_000));
    await pool.connect(funder).fund(stable(1_000_000));
    await stock.mint(borrower.address, shares(100));
    await stock.connect(borrower).approve(await engine.getAddress(), ethers.MaxUint256);
  });

  it("still writes a loan on a Saturday, against Friday's close", async () => {
    // The venue shut two days ago. The closing print is the only print there
    // is, and the after-hours haircut is what pays for using it.
    const closedAt = (await time.latest()) - 2 * 24 * 60 * 60;
    await oracle.postPrice(await stock.getAddress(), usd(220), closedAt, false, "NasdaqGS close");
    const q = await engine.quote(await stock.getAddress(), shares(10), TENOR);
    expect(q.marketOpen).to.equal(false);
    expect(q.ltvBps).to.equal(3_150n);
    await expect(
      engine.connect(borrower).openLoan(
        await stock.getAddress(), shares(10), merchant.address, ethers.id("sat"), q.maxBorrow, TENOR
      )
    ).to.not.be.reverted;
  });

  it("still rejects a print older than the closed-market bound", async () => {
    const ancient = (await time.latest()) - 5 * 24 * 60 * 60;
    await oracle.postPrice(await stock.getAddress(), usd(220), ancient, false, "stale");
    await expect(engine.quote(await stock.getAddress(), shares(10), TENOR))
      .to.be.revertedWithCustomError(oracle, "StalePrice");
  });

  it("holds the tight bound while the venue is open", async () => {
    const twentyMinsAgo = (await time.latest()) - 20 * 60;
    await oracle.postPrice(await stock.getAddress(), usd(220), twentyMinsAgo, true, "live");
    await expect(engine.quote(await stock.getAddress(), shares(10), TENOR))
      .to.be.revertedWithCustomError(oracle, "StalePrice");
  });

  it("will not let the closed bound be set tighter than the open one", async () => {
    await expect(oracle.setMaxAge(3600, 60)).to.be.revertedWith("closed bound must be the looser one");
    await expect(oracle.setMaxAge(900, 4 * 86400)).to.not.be.reverted;
  });
});

describe("Stockline — the sequencer goes down", () => {
  let owner, borrower, merchant, liquidator, funder;
  let stock, usdt, oracle, pool, engine, feed;
  const usd = (n) => BigInt(Math.round(n * 1e8));
  const stable = (n) => BigInt(Math.round(n * 1e6));
  const shares = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
  const TENOR = 7 * 24 * 60 * 60;

  beforeEach(async () => {
    [owner, borrower, merchant, liquidator, funder] = await ethers.getSigners();
    stock = await (await ethers.getContractFactory("TestnetStock")).deploy("t", "tXAAPL", 18, owner.address);
    usdt = await (await ethers.getContractFactory("MockUSDC")).deploy();
    oracle = await (await ethers.getContractFactory("StockPriceOracle")).deploy(owner.address);
    pool = await (await ethers.getContractFactory("LiquidityPool")).deploy(await usdt.getAddress(), owner.address);
    engine = await (await ethers.getContractFactory("StocklineEngine")).deploy(
      await usdt.getAddress(), await oracle.getAddress(), await pool.getAddress(), owner.address
    );
    feed = await (await ethers.getContractFactory("SequencerFeedStub")).deploy();
    await pool.setEngine(await engine.getAddress());
    await engine.setAcceptedStock(await stock.getAddress(), true);
    await engine.setSequencerUptimeFeed(await feed.getAddress(), 3600);
    await oracle.postPrice(await stock.getAddress(), usd(220), await time.latest(), true, "live");

    await usdt.mint(funder.address, stable(1_000_000));
    await usdt.connect(funder).approve(await pool.getAddress(), stable(1_000_000));
    await pool.connect(funder).fund(stable(1_000_000));
    await stock.mint(borrower.address, shares(100));
    await stock.connect(borrower).approve(await engine.getAddress(), ethers.MaxUint256);
    await usdt.mint(borrower.address, stable(10_000));
    await usdt.connect(borrower).approve(await engine.getAddress(), ethers.MaxUint256);
    await usdt.mint(liquidator.address, stable(100_000));
    await usdt.connect(liquidator).approve(await engine.getAddress(), ethers.MaxUint256);

    // A position that a price crash will put underwater.
    await feed.set(0, (await time.latest()) - 86400); // up, and has been for a day
    await engine.connect(borrower).openLoan(
      await stock.getAddress(), shares(10), merchant.address, ethers.id("seq"), stable(700), TENOR
    );
    await oracle.postPrice(await stock.getAddress(), usd(130), await time.latest(), true, "live");
  });

  it("is liquidatable while the sequencer is healthy", async () => {
    expect(await engine.sequencerOk()).to.equal(true);
    expect(await engine.isLiquidatable(0)).to.equal(true);
  });

  it("is NOT liquidatable while the sequencer is down", async () => {
    await feed.set(1, await time.latest()); // down
    expect(await engine.sequencerOk()).to.equal(false);
    expect(await engine.isLiquidatable(0)).to.equal(false);
    await expect(engine.connect(liquidator).liquidate(0)).to.be.revertedWithCustomError(engine, "NotLiquidatable");
  });

  it("stays protected through the grace period after it comes back", async () => {
    await feed.set(0, await time.latest()); // just came back up
    expect(await engine.isLiquidatable(0)).to.equal(false);
    await time.increase(1800); // half an hour in — still inside the window
    expect(await engine.isLiquidatable(0)).to.equal(false);
    await time.increase(1900); // past the hour
    // The price went stale while we waited — which is exactly the state after
    // a real outage. A stale print is not a licence to liquidate.
    expect(await engine.isLiquidatable(0)).to.equal(false);
    await oracle.postPrice(await stock.getAddress(), usd(130), await time.latest(), true, "live");
    expect(await engine.isLiquidatable(0)).to.equal(true);
  });

  it("will not liquidate on a stale price even when the sequencer is fine", async () => {
    await time.increase(20 * 60);
    expect(await engine.sequencerOk()).to.equal(true);
    expect(await engine.isLiquidatable(0)).to.equal(false);
    expect(await engine.healthFactor(0)).to.equal(ethers.MaxUint256);
    await expect(engine.connect(liquidator).liquidate(0)).to.be.revertedWithCustomError(engine, "NotLiquidatable");
  });

  it("lets the borrower repay even while the sequencer feed says down", async () => {
    // If they can get a transaction through at all, they can always get out.
    await feed.set(1, await time.latest());
    await expect(engine.connect(borrower).repay(0)).to.not.be.reverted;
    expect(await stock.balanceOf(borrower.address)).to.equal(shares(100));
  });

  it("skips the check entirely where no feed exists, as on X Layer testnet", async () => {
    await engine.setSequencerUptimeFeed(ethers.ZeroAddress, 3600);
    expect(await engine.sequencerOk()).to.equal(true);
    expect(await engine.isLiquidatable(0)).to.equal(true);
  });
});
