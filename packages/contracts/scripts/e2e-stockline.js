/**
 * The whole product, end to end, against a real market print.
 *
 * This is the demo: lock -> merchant paid -> health -> repay -> unlock, then a
 * second position taken down by a price move to show that liquidation sells
 * only what it needs. Nothing here is simulated except the price *move* — the
 * opening price is the live print from the venue.
 *
 *   npx hardhat run scripts/e2e-stockline.js --network xlayerTestnet
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const D6 = 1_000_000n;
const D8 = 100_000_000n;
const fmt6 = (v) => (Number(v) / 1e6).toFixed(2);
const fmt18 = (v) => (Number(v) / 1e18).toFixed(4);
const fmt8 = (v) => (Number(v) / 1e8).toFixed(2);

async function livePrint(symbol) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`,
    { headers: { "User-Agent": "Mozilla/5.0 stockline" } }
  );
  const m = (await res.json())?.chart?.result?.[0]?.meta;
  const now = Math.floor(Date.now() / 1000);
  const reg = m.currentTradingPeriod?.regular;
  return {
    price: BigInt(Math.round(m.regularMarketPrice * 1e8)),
    printedAt: Number(m.regularMarketTime),
    open: !!reg && now >= reg.start && now < reg.end,
    source: `${m.fullExchangeName || m.exchangeName} ${!!reg && now >= reg.start && now < reg.end ? "last" : "close"}`,
    human: m.regularMarketPrice,
  };
}

async function main() {
  const file = path.join(__dirname, "..", "deployments", `stockline-${network.name}.json`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const signers = await ethers.getSigners();
  const [deployer] = signers;
  // On a real network there is one key; locally there are twenty.
  const shopper = signers[1] ?? deployer;
  const merchant = signers[2] ?? deployer;
  const liquidator = signers[3] ?? deployer;

  const engine = await ethers.getContractAt("StocklineEngine", dep.contracts.engine);
  const oracle = await ethers.getContractAt("StockPriceOracle", dep.contracts.oracle);
  const pool = await ethers.getContractAt("LiquidityPool", dep.contracts.pool);
  const stock = await ethers.getContractAt("TestnetStock", dep.contracts.stock);
  const stable = await ethers.getContractAt("MockUSDC", dep.contracts.stable);
  const receipts = [];
  /**
   * Send, confirm, and then wait for the node we read from to have caught up.
   *
   * A local chain answers reads from the state the transaction just wrote.
   * A public RPC does not: X Layer's testnet endpoint served pre-transaction
   * state straight after `wait()` returned, so an openLoan that had genuinely
   * landed read back as loanCount 0, merchant paid nothing, no shares locked.
   * The transaction was fine; the read was behind. Wait for the node to reach
   * the block the receipt is in before believing anything it says.
   */
  const rec = async (label, tx) => {
    const r = await tx.wait();
    for (let i = 0; i < 40; i++) {
      if ((await ethers.provider.getBlockNumber()) >= r.blockNumber) break;
      await new Promise((res) => setTimeout(res, 500));
    }
    receipts.push({ label, hash: r.hash, block: r.blockNumber, gasUsed: r.gasUsed.toString() });
    console.log(`    ${label}  ${r.hash}`);
    return r;
  };

  console.log(`\n── the print ────────────────────────────────────────────────`);
  const live = await livePrint(process.env.STOCK_SYMBOL || "AAPL");
  console.log(`  ${process.env.STOCK_SYMBOL || "AAPL"}  $${live.human}  ${live.open ? "market OPEN" : "market CLOSED"}  source: ${live.source}`);
  await rec("post price", await oracle.postPrice(dep.contracts.stock, live.price, live.printedAt, live.open, live.source));

  console.log(`\n── 1. the shopper has shares, the merchant wants stablecoin ──`);
  const shares = ethers.parseUnits("10", 18);
  await rec("mint shares to shopper", await stock.mint(shopper.address, shares));
  await rec("approve engine", await stock.connect(shopper).approve(dep.contracts.engine, ethers.MaxUint256));
  const q = await engine.quote(dep.contracts.stock, shares, 7 * 86400);
  console.log(`    10 shares are worth  $${fmt6(q.collateralValue)}`);
  console.log(`    ceiling at ${Number(q.ltvBps) / 100}% LTV  $${fmt6(q.maxBorrow)}`);

  console.log(`\n── 2. pay the merchant with stock credit ────────────────────`);
  const borrow = q.maxBorrow / 2n; // a $x basket, well inside the ceiling
  const merchantBefore = await stable.balanceOf(merchant.address);
  await rec(
    "openLoan",
    await engine.connect(shopper).openLoan(
      dep.contracts.stock, shares, merchant.address, ethers.id("basket-" + Date.now()), borrow, 7 * 86400
    )
  );
  const id = Number(await engine.loanCount()) - 1;
  const merchantAfter = await stable.balanceOf(merchant.address);
  console.log(`    merchant received     $${fmt6(merchantAfter - merchantBefore)}  (immediately, from the pool)`);
  console.log(`    shares locked         ${fmt18(await stock.balanceOf(dep.contracts.engine))}`);
  const l = await engine.getLoan(id);
  // The upside is in the locked shares, not in a leftover balance: the whole
  // point is that the position was never closed.
  console.log(`    position kept         ${fmt18(l.shares)} shares still owned, still exposed`);
  console.log(`    owed                  $${fmt6(await engine.amountOwed(id))} by ${new Date(Number(l.dueAt) * 1000).toISOString().slice(0, 10)}`);
  console.log(`    health factor         ${(Number(await engine.healthFactor(id)) / 1e18).toFixed(2)}`);

  console.log(`\n── 3. repay, and the shares come back ───────────────────────`);
  const owed = await engine.amountOwed(id);
  await rec("mint repayment to shopper", await stable.mint(shopper.address, owed));
  await rec("approve", await stable.connect(shopper).approve(dep.contracts.engine, ethers.MaxUint256));
  await rec("repay", await engine.connect(shopper).repay(id));
  console.log(`    shopper holds         ${fmt18(await stock.balanceOf(shopper.address))} shares — all of them`);
  console.log(`    pool outstanding      $${fmt6(await pool.outstanding())}`);
  console.log(`    pool earned           $${fmt6(await pool.earned())}`);

  console.log(`\n── 4. the other path: a price move takes a position down ────`);
  await rec("approve again", await stock.connect(shopper).approve(dep.contracts.engine, ethers.MaxUint256));
  await rec(
    "openLoan #2",
    await engine.connect(shopper).openLoan(
      dep.contracts.stock, shares, merchant.address, ethers.id("basket2-" + Date.now()), q.maxBorrow, 7 * 86400
    )
  );
  const id2 = Number(await engine.loanCount()) - 1;
  console.log(`    borrowed at the full ceiling, health ${(Number(await engine.healthFactor(id2)) / 1e18).toFixed(2)}`);

  const crashed = (live.price * 55n) / 100n; // -45%: through the 50% threshold
  // Liquidation demands a live print: while the venue is shut the collateral
  // cannot actually be sold, so the engine will not let it be seized. To
  // exercise the path out of hours the demo posts the moved price marked
  // open, and says so rather than hiding it.
  if (!live.open) {
    console.log(`    NOTE: the venue is shut, so a real liquidation could not run right now.`);
    console.log(`          Posting the moved price marked OPEN purely to exercise the path.`);
  }
  await rec(
    "post crashed price",
    await oracle.postPrice(
      dep.contracts.stock, crashed, Math.floor(Date.now() / 1000), true,
      live.source + (live.open ? " (demo move)" : " (demo move, venue marked open to exercise liquidation)")
    )
  );
  console.log(`    price now $${fmt8(crashed)}  health ${(Number(await engine.healthFactor(id2)) / 1e18).toFixed(2)}  liquidatable: ${await engine.isLiquidatable(id2)}`);

  const debt = await engine.amountOwed(id2);
  await rec("fund liquidator", await stable.mint(liquidator.address, debt));
  await rec("liquidator approves", await stable.connect(liquidator).approve(dep.contracts.engine, ethers.MaxUint256));
  const shopperBefore = await stock.balanceOf(shopper.address);
  await rec("liquidate", await engine.connect(liquidator).liquidate(id2));
  const seized = await stock.balanceOf(liquidator.address);
  const returned = (await stock.balanceOf(shopper.address)) - shopperBefore;
  console.log(`    liquidator took       ${fmt18(seized)} shares (debt + 5% bonus)`);
  console.log(`    shopper got back      ${fmt18(returned)} shares — only what was needed was sold`);
  console.log(`    seized + returned     ${fmt18(seized + returned)} of ${fmt18(shares)} locked`);

  const out = {
    network: network.name,
    chainId: Number(network.config.chainId),
    ranAt: new Date().toISOString(),
    openingPrint: { symbol: process.env.STOCK_SYMBOL || "AAPL", usd: live.human, printedAt: live.printedAt, source: live.source, marketOpen: live.open },
    loans: { repaid: id, liquidated: id2 },
    transactions: receipts,
  };
  const f = path.join(__dirname, "..", "deployments", `e2e-stockline-${network.name}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${f}  (${receipts.length} transactions)\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
