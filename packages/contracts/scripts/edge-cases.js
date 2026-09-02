/**
 * F1 and F2, exercised for real.
 *
 * No fixtures and no stubs: the staleness bound is genuinely tightened on the
 * deployed oracle so a real print really does age out, and the pool's float is
 * genuinely withdrawn so a checkout really does meet an empty warehouse. Both
 * are restored afterwards.
 */
const { ethers, network } = require("hardhat");
const fs = require("fs"); const path = require("path");

const P = process.env.APP || "http://localhost:3200";

/**
 * X Layer's RPC serves pre-transaction state straight after a receipt, so a
 * call that depends on the previous one must wait for the node to catch up.
 * This script learned that the hard way: it approved and funded in the same
 * breath and the fund reverted on a zero allowance, leaving the pool drained.
 */
const settled = async (tx) => {
  const r = await tx.wait();
  for (let i = 0; i < 40; i++) {
    if ((await ethers.provider.getBlockNumber()) >= r.blockNumber) return r;
    await new Promise((s) => setTimeout(s, 500));
  }
  return r;
};
const post = async (p, body) => {
  const r = await fetch(P + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `stockline-${network.name}.json`), "utf8"));
  const oracle = await ethers.getContractAt("StockPriceOracle", dep.contracts.oracle);
  const pool = await ethers.getContractAt("LiquidityPool", dep.contracts.pool);
  const stable = await ethers.getContractAt("MockUSDC", dep.contracts.stable);
  const [deployer] = await ethers.getSigners();

  // ── F1 · a genuinely stale print ────────────────────────────────────────
  console.log("F1  stale price");
  const openBound = await oracle.maxAge();
  const closedBound = await oracle.maxAgeWhenClosed();
  await settled(await oracle.setMaxAge(60, 60));
  console.log(`    bound tightened to 60s (was ${openBound}s / ${closedBound}s); waiting for the print to age out`);
  let r;
  for (let i = 0; i < 30; i++) {
    await new Promise((s) => setTimeout(s, 5000));
    r = await post("/api/quote", { shares: 1, tenorDays: 7 });
    if (r.status !== 200) break;
  }
  console.log(`    quote -> ${r.status}  ${JSON.stringify(r.body)}`);
  const f1 = r.status === 409 && /stale/i.test(r.body.error || "");
  console.log(`    ${f1 ? "PASS" : "FAIL"}  a stale print refuses a quote and says why\n`);
  await settled(await oracle.setMaxAge(openBound, closedBound));
  await post("/api/price", { mode: "relay" });
  console.log(`    bounds restored, fresh print posted\n`);

  // ── F2 · an empty warehouse ─────────────────────────────────────────────
  console.log("F2  empty pool");
  const avail = await pool.available();
  await settled(await pool.withdraw(deployer.address, avail));
  console.log(`    withdrew ${ethers.formatUnits(avail, 6)} — pool now ${ethers.formatUnits(await pool.available(), 6)}`);
  const q = await post("/api/quote", { shares: 1, tenorDays: 7 });
  const c = await post("/api/checkout", { shares: 1, borrowAmount: q.body.maxBorrow, orderRef: "empty-" + Date.now(), tenorDays: 7 });
  console.log(`    checkout -> ${c.status}  ${JSON.stringify(c.body)}`);
  const f2 = c.status !== 200 && !/unknown|CALL_EXCEPTION/i.test(c.body.error || "");
  console.log(`    ${f2 ? "PASS" : "FAIL"}  an empty pool refuses a checkout in plain words\n`);

  await settled(await stable.approve(dep.contracts.pool, ethers.MaxUint256));
  await settled(await pool.fund(avail));
  console.log(`    refunded the warehouse — pool now ${ethers.formatUnits(await pool.available(), 6)}`);

  process.exit(f1 && f2 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
