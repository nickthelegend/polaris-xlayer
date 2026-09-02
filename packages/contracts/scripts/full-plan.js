/**
 * Phase 4: the whole plan again, top to bottom, against the live deployment.
 * Nothing is stubbed. Every assertion reads the chain or the running app.
 */
const { ethers, network } = require("hardhat");
const fs = require("fs"); const path = require("path");

const APP = process.env.APP || "http://localhost:3200";
const results = [];
const rec = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${detail}`); };

const get = async (p) => { const r = await fetch(APP + p); return { status: r.status, body: await r.json() }; };
const post = async (p, b) => {
  const r = await fetch(APP + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
};
const settled = async (tx) => {
  const r = await tx.wait();
  for (let i = 0; i < 40; i++) { if ((await ethers.provider.getBlockNumber()) >= r.blockNumber) return r; await new Promise(s => setTimeout(s, 500)); }
  return r;
};

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `stockline-${network.name}.json`), "utf8"));
  const engine = await ethers.getContractAt("StocklineEngine", dep.contracts.engine);
  const pool = await ethers.getContractAt("LiquidityPool", dep.contracts.pool);
  const stock = await ethers.getContractAt("TestnetStock", dep.contracts.stock);
  const oracle = await ethers.getContractAt("StockPriceOracle", dep.contracts.oracle);

  console.log("\nB · API\n");
  await post("/api/price", { mode: "relay" });
  let r = await get("/api/state");
  rec("B1", r.status === 200 && r.body.blockNumber > 0 && Array.isArray(r.body.loans), `state 200, block ${r.body.blockNumber}, ${r.body.loans?.length} loans`);

  r = await post("/api/quote", { shares: 10, tenorDays: 7 });
  const q = r.body;
  const ceiling = BigInt(q.collateralValue) * BigInt(q.ltvBps) / 10000n;
  rec("B2", r.status === 200 && BigInt(q.maxBorrow) + BigInt(q.feeOnMax) <= ceiling && [3500, 3150].includes(q.ltvBps),
      `ltv ${q.ltvBps}bps, borrow+fee ${BigInt(q.maxBorrow)+BigInt(q.feeOnMax)} <= ceiling ${ceiling}`);

  r = await post("/api/quote", { shares: 0 });            rec("B3", r.status === 400 && /greater than zero/.test(r.body.error), r.body.error);
  r = await post("/api/quote", { shares: "abc" });         rec("B4", r.status === 400 && /greater than zero/.test(r.body.error), r.body.error);
  r = await post("/api/quote", { shares: 1, tenorDays: 3 });rec("B5", r.status === 400 && /7 and 14/.test(r.body.error), r.body.error);

  const ref = "plan-" + Date.now();
  const q1 = (await post("/api/quote", { shares: 2, tenorDays: 7 })).body;
  const before = await get("/api/state");
  r = await post("/api/checkout", { shares: 2, borrowAmount: q1.maxBorrow, orderRef: ref, tenorDays: 7 });
  const loanId = r.body.loanId;
  rec("B6", r.status === 200 && typeof loanId === "number" && /^0x/.test(r.body.hash), `loan ${loanId} tx ${String(r.body.hash).slice(0,14)}…`);

  const dup = await post("/api/checkout", { shares: 2, borrowAmount: q1.maxBorrow, orderRef: ref, tenorDays: 7 });
  const afterDup = await get("/api/state");
  rec("B7", dup.status === 409 && afterDup.body.loans.length === before.body.loans.length + 1,
      `${dup.status}, exactly one loan created`);

  r = await post("/api/checkout", { shares: 99999, borrowAmount: "1", orderRef: "x"+Date.now() });
  rec("B8", r.status === 400 && /You hold/.test(r.body.error), r.body.error.slice(0, 60));
  r = await post("/api/checkout", { shares: 1, borrowAmount: "1", orderRef: "  " });
  rec("B9", r.status === 400 && /reference is required/.test(r.body.error), r.body.error);

  console.log("\nC · flows\n");
  const st1 = await get("/api/state");
  const merchBefore = BigInt(st1.body.balances.merchantStable);
  const engBefore = BigInt(st1.body.balances.engineShares);
  const l = st1.body.loans.find(x => x.id === loanId);
  rec("C2", BigInt(l.principal) === BigInt(q1.maxBorrow), `merchant paid ${l.principal} == quoted ${q1.maxBorrow}`);
  rec("C3", BigInt(l.shares) === ethers.parseUnits("2", 18), `locked ${ethers.formatUnits(l.shares,18)} shares`);
  rec("C4", l.status === 1 && Number(l.healthFactor) > 1, `active, health ${l.healthFactor}`);

  const rp = await post("/api/repay", { loanId, action: "repay" });
  const st2 = await get("/api/state");
  const l2 = st2.body.loans.find(x => x.id === loanId);
  rec("C5", rp.status === 200 && l2.status === 2 && BigInt(st2.body.balances.engineShares) === engBefore - BigInt(l.shares),
      `repaid, ${ethers.formatUnits(l.shares,18)} shares returned`);
  rec("B10", rp.status === 200, `repay 200`);
  r = await post("/api/repay", { loanId, action: "repay" });
  rec("B11", r.status === 409 && /already closed/.test(r.body.error), r.body.error);

  // refund
  const refRef = "refund-" + Date.now();
  const q2 = (await post("/api/quote", { shares: 1, tenorDays: 7 })).body;
  const c2 = await post("/api/checkout", { shares: 1, borrowAmount: q2.maxBorrow, orderRef: refRef, tenorDays: 7 });
  const stA = await get("/api/state");
  const mA = BigInt(stA.body.balances.merchantStable);
  const rf = await post("/api/repay", { loanId: c2.body.loanId, action: "refund" });
  const stB = await get("/api/state");
  const lr = stB.body.loans.find(x => x.id === c2.body.loanId);
  const owed = BigInt(q2.maxBorrow) + BigInt(q2.feeOnMax);
  rec("C6", rf.status === 200 && lr.status === 4 && mA - BigInt(stB.body.balances.merchantStable) === owed,
      `refunded, merchant returned ${ethers.formatUnits(owed,6)}`);

  // healthy loan cannot be liquidated
  const q3 = (await post("/api/quote", { shares: 1, tenorDays: 7 })).body;
  const c3 = await post("/api/checkout", { shares: 1, borrowAmount: q3.maxBorrow, orderRef: "liq-"+Date.now(), tenorDays: 7 });
  r = await post("/api/repay", { loanId: c3.body.loanId, action: "liquidate" });
  rec("B12", r.status === 409 && /healthy/.test(r.body.error), r.body.error);

  // crash, then liquidate
  const crash = await post("/api/price", { mode: "move", pct: -45 });
  rec("B14", crash.status === 200 && /demo move/.test(crash.body.source), `$${(Number(crash.body.usdPerShare)/1e8).toFixed(2)} — ${crash.body.source}`);
  const stC = await get("/api/state");
  const lc = stC.body.loans.find(x => x.id === c3.body.loanId);
  const shopBefore = BigInt(stC.body.balances.shopperShares);
  const engC = BigInt(stC.body.balances.engineShares);
  const liq = await post("/api/repay", { loanId: c3.body.loanId, action: "liquidate" });
  const stD = await get("/api/state");
  const returned = BigInt(stD.body.balances.shopperShares) - shopBefore;
  const seized = (engC - BigInt(stD.body.balances.engineShares)) - returned;
  rec("C7", liq.status === 200 && seized + returned === BigInt(lc.shares) && returned > 0n,
      `seized ${ethers.formatUnits(seized,18)} + returned ${ethers.formatUnits(returned,18)} == locked ${ethers.formatUnits(lc.shares,18)}`);

  const back = await post("/api/price", { mode: "relay" });
  rec("C8", back.status === 200 && !/demo move/.test(back.body.source), `${back.body.source} — label cleared`);
  r = await post("/api/price", { mode: "move", pct: -200 }); rec("B15", r.status === 400 && /above -100/.test(r.body.error), r.body.error);
  const shSt = await get("/api/state");
  const fa = await post("/api/faucet", { shares: 5 });
  const shSt2 = await get("/api/state");
  rec("B16", fa.status === 200 && BigInt(shSt2.body.balances.shopperShares) - BigInt(shSt.body.balances.shopperShares) === ethers.parseUnits("5", 18), "+5.0000 shares");
  r = await post("/api/faucet", { shares: 500 }); rec("B17", r.status === 400 && /between 0 and 100/.test(r.body.error), r.body.error);
  r = await get("/api/state?as=merchant"); rec("A5", r.status === 200 && r.body.loans.length === 0, "merchant view is empty");

  console.log("\nD · invariants\n");
  const n = Number(await engine.loanCount());
  let ap = 0n, as = 0n;
  for (let i = 0; i < n; i++) { const x = await engine.getLoan(i); if (Number(x.status) === 1) { ap += x.principal; as += x.shares; } }
  rec("D2", (await pool.outstanding()) === ap, `outstanding ${ap} == sum(active principal)`);
  rec("D3", (await stock.balanceOf(dep.contracts.engine)) === as, `engine holds ${ethers.formatUnits(as,18)} == sum(active shares)`);

  const head = await ethers.provider.getBlockNumber();
  const logs = [];
  for (let to = head; to > head - 4000; to -= 100) {
    logs.push(...await engine.queryFilter(engine.filters.LoanLiquidated(), Math.max(0, to - 99), to));
    if (to - 100 <= 0) break;
  }
  let d1 = true;
  for (const ev of logs) { const x = await engine.getLoan(Number(ev.args.loanId)); if (ev.args.sharesSeized + ev.args.sharesReturned !== x.shares) d1 = false; }
  rec("D1", d1 && logs.length > 0, `${logs.length} liquidations, all conserve shares`);

  const ltv = await engine.maxLtvBps(); const hc = await engine.closedMarketHaircutBps();
  let d4 = true;
  for (let i = 0; i < n; i++) {
    const x = await engine.getLoan(i);
    if (Number(x.status) !== 1) continue;
    const v = await engine.collateralValueOf(x.stock, x.shares, x.openPrice);
    const cap = (v * (x.openedWhileClosed ? (ltv * (10000n - hc)) / 10000n : ltv)) / 10000n;
    if (x.principal + x.fee > cap) d4 = false;
  }
  rec("D4", d4, "every active loan inside its opening ceiling");

  console.log("\nE · external\n");
  rec("E1", Number((await ethers.provider.getNetwork()).chainId) === 1952, "X Layer chainId 1952");
  const y = await (await fetch("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1m&range=1d", { headers: { "User-Agent": "Mozilla/5.0" } })).json();
  const meta = y?.chart?.result?.[0]?.meta;
  rec("E2", !!meta?.regularMarketPrice && !!meta?.regularMarketTime && !!meta?.currentTradingPeriod, `AAPL ${meta?.regularMarketPrice}`);
  const ex = await fetch(`https://www.oklink.com/x-layer-testnet/tx/${c3.body.hash}`);
  rec("E3", ex.status === 200, `explorer ${ex.status}`);

  const pass = results.filter(x => x.ok).length;
  console.log(`\n${pass}/${results.length} scripted items pass`);
  const failed = results.filter(x => !x.ok);
  if (failed.length) { console.log("FAILED: " + failed.map(f => f.id).join(", ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
