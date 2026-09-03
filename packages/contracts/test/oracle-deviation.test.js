const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * The circuit breaker on the mark.
 *
 * Every open position is valued against the oracle's number, so a relayer
 * could mark the whole book down in one transaction and liquidate it. The
 * staleness bounds stopped an old price being used; nothing stopped a wrong
 * one being posted.
 */
describe("StockPriceOracle — deviation bound", () => {
  let oracle, stock, owner, relayer;
  const NOW = () => Math.floor(Date.now() / 1000);

  beforeEach(async () => {
    [owner, relayer] = await ethers.getSigners();
    oracle = await (await ethers.getContractFactory("StockPriceOracle")).deploy(owner.address);
    await oracle.waitForDeployment();
    await oracle.setRelayer(relayer.address, true);
    stock = ethers.Wallet.createRandom().address;
    await oracle.postPrice(stock, 100_00000000n, NOW(), true, "seed");
  });

  it("takes the first print, which has nothing to deviate from", async () => {
    const fresh = ethers.Wallet.createRandom().address;
    await expect(oracle.postPrice(fresh, 500_00000000n, NOW(), true, "first")).to.not.be.reverted;
  });

  it("accepts an ordinary move", async () => {
    await expect(oracle.connect(relayer).postPrice(stock, 105_00000000n, NOW() + 1, true, "up 5%"))
      .to.not.be.reverted;
  });

  it("accepts a move exactly at the bound", async () => {
    await expect(oracle.connect(relayer).postPrice(stock, 120_00000000n, NOW() + 1, true, "up 20%"))
      .to.not.be.reverted;
  });

  it("refuses a relayer marking the book down 45%", async () => {
    await expect(oracle.connect(relayer).postPrice(stock, 55_00000000n, NOW() + 1, true, "crash"))
      .to.be.revertedWithCustomError(oracle, "DeviationTooLarge");
  });

  it("refuses a relayer taking the mark to near zero", async () => {
    await expect(oracle.connect(relayer).postPrice(stock, 1n, NOW() + 1, true, "attack"))
      .to.be.revertedWithCustomError(oracle, "DeviationTooLarge");
  });

  it("lets the owner override, on the record", async () => {
    await expect(oracle.postPriceOverride(stock, 55_00000000n, NOW() + 1, true, "venue", "gap down"))
      .to.emit(oracle, "PriceOverridden");
    const [price] = await oracle.peek(stock);
    expect(price).to.equal(55_00000000n);
  });

  it("does not let a relayer use the override", async () => {
    await expect(
      oracle.connect(relayer).postPriceOverride(stock, 55_00000000n, NOW() + 1, true, "venue", "nope")
    ).to.be.reverted;
  });

  it("still refuses a zero price through the override", async () => {
    await expect(oracle.postPriceOverride(stock, 0n, NOW() + 1, true, "venue", "zero"))
      .to.be.revertedWithCustomError(oracle, "ZeroPrice");
  });

  it("still refuses to walk the clock backwards through the override", async () => {
    await expect(oracle.postPriceOverride(stock, 105_00000000n, NOW() - 3600, true, "venue", "back"))
      .to.be.revertedWithCustomError(oracle, "PriceWentBackwards");
  });

  it("cannot be tightened into a denial of service, or widened into nothing", async () => {
    await expect(oracle.setMaxDeviation(50)).to.be.reverted;
    await expect(oracle.setMaxDeviation(9500)).to.be.reverted;
    await expect(oracle.setMaxDeviation(3000)).to.not.be.reverted;
    expect(await oracle.maxDeviationBps()).to.equal(3000n);
  });

  it("reports whether a print would pass, without posting it", async () => {
    expect(await oracle.withinDeviation(stock, 110_00000000n)).to.equal(true);
    expect(await oracle.withinDeviation(stock, 55_00000000n)).to.equal(false);
  });
});
