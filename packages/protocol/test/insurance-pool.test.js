const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * The pool used to credit a stake without moving a token.
 *
 * These tests exist because `stakeCTC` was one line of arithmetic under the
 * comment "// Mock transfer from user": any caller could claim any stake for
 * free, and the protocol sizes its default risk against that number.
 */
describe("InsurancePool", () => {
  let token, pool, staker, treasury;

  beforeEach(async () => {
    [, staker, treasury] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 18);
    await token.waitForDeployment();
    pool = await (await ethers.getContractFactory("InsurancePool")).deploy(await token.getAddress());
    await pool.waitForDeployment();
    await token.mint(staker.address, ethers.parseEther("1000"));
  });

  it("refuses a stake that was never approved, instead of crediting it", async () => {
    await expect(pool.connect(staker).stakeCTC(ethers.parseEther("100"))).to.be.reverted;
    expect(await pool.totalStaked()).to.equal(0n);
  });

  it("moves real tokens in, and credits only what arrived", async () => {
    const amount = ethers.parseEther("100");
    await token.connect(staker).approve(await pool.getAddress(), amount);
    await pool.connect(staker).stakeCTC(amount);

    expect(await token.balanceOf(await pool.getAddress())).to.equal(amount);
    expect(await pool.totalStaked()).to.equal(amount);
    expect(await pool.stakedCTC(staker.address)).to.equal(amount);
  });

  it("lets a staker withdraw what they actually put in", async () => {
    const amount = ethers.parseEther("100");
    await token.connect(staker).approve(await pool.getAddress(), amount);
    await pool.connect(staker).stakeCTC(amount);

    const before = await token.balanceOf(staker.address);
    await pool.connect(staker).unstake(amount);
    expect(await token.balanceOf(staker.address)).to.equal(before + amount);
    expect(await pool.totalStaked()).to.equal(0n);
  });

  it("cannot withdraw more than staked", async () => {
    const amount = ethers.parseEther("100");
    await token.connect(staker).approve(await pool.getAddress(), amount);
    await pool.connect(staker).stakeCTC(amount);
    await expect(pool.connect(staker).unstake(amount + 1n)).to.be.revertedWithCustomError(pool, "InsufficientStake");
  });

  it("slashing moves real tokens to the recipient", async () => {
    const amount = ethers.parseEther("100");
    await token.connect(staker).approve(await pool.getAddress(), amount);
    await pool.connect(staker).stakeCTC(amount);

    await pool.slashInsurance(treasury.address, ethers.parseEther("40"));
    expect(await token.balanceOf(treasury.address)).to.equal(ethers.parseEther("40"));
    expect(await pool.totalStaked()).to.equal(ethers.parseEther("60"));
  });

  it("cannot slash more insurance than the pool holds", async () => {
    await expect(pool.slashInsurance(treasury.address, 1n)).to.be.revertedWithCustomError(pool, "InsufficientInsurance");
  });

  it("only the owner can slash", async () => {
    await expect(pool.connect(staker).slashInsurance(staker.address, 0n)).to.be.reverted;
  });
});
