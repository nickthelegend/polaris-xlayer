/**
 * The whole test plan against the live deployment.
 *
 * Reads go through the running app, because that is the surface a visitor
 * gets. Writes are signed by real keys, exactly as a connected wallet signs
 * them in the browser — the app has no write routes to drive any more, and a
 * harness that POSTed to them would be testing something that no longer
 * exists.
 *
 *   APP=https://polaris-xlayer.vercel.app npx hardhat run scripts/verify-live.js --network xlayerTestnet
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const APP = process.env.APP || "http://localhost:3200";
const results = [];
const rec = (id, ok, detail) => {
  results.push({ id, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id.padEnd(6)} ${detail}`);
};
const get = async (p) => {
  const r = await fetch(APP + p);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const post = async (p, b, headers = {}) => {
  const r = await fetch(APP + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(b),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
/**
 * The name of the custom error a call reverted with.
 *
 * ethers does not put it in `e.message` — a revert from estimateGas arrives as
 * "unknown custom error" with the selector buried in the payload — so matching
 * on the message silently fails and a passing guard reads as a broken one.
 */
const revertName = (iface, e) => {
  const d =
    e?.data ??
    e?.info?.error?.data ??
    (String(e?.message ?? "").match(/(0x[0-9a-fA-F]{8,})/) || [])[1];
  if (!d) return null;
  try { return iface.parseError(d)?.name ?? null; } catch { return null; }
};

const settled = async (tx) => {
  const r = await tx.wait();
  for (let i = 0; i < 40; i++) {
    if ((await ethers.provider.getBlockNumber()) >= r.blockNumber) return r;
    await new Promise((s) => setTimeout(s, 500));
  }
  return r;
};

async function main() {
  const dep = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", `polaris-${network.name}.json`), "utf8")
  );
  const [, shopper, merchant, liquidator] = await ethers.getSigners();
  const engine = await ethers.getContractAt("PolarisEngine", dep.contracts.engine);
  const pool = await ethers.getContractAt("LiquidityPool", dep.contracts.pool);
  const stock = await ethers.getContractAt("TestnetStock", dep.contracts.stock);
  const stable = await ethers.getContractAt("MockUSDC", dep.contracts.stable);
  const relayerKey = process.env.RELAYER_KEY;

  console.log(`\napp     ${APP}`);
  console.log(`chain   ${network.name} (${(await ethers.provider.getNetwork()).chainId})`);
  console.log(`shopper ${shopper.address}\n`);

  console.log("SECURITY\n");
  for (const r of ["checkout", "repay", "faucet"]) {
    const res = await post(`/api/stock/${r}`, {});
    rec(`S:${r}`, res.status === 404, `POST /api/stock/${r} -> ${res.status}, no server-signing route`);
  }
  let res = await post("/api/stock/price", { mode: "move", pct: -45 });
  rec("S:px", res.status === 401, `an unauthenticated price move -> ${res.status}`);
  if (relayerKey) {
    res = await post("/api/stock/price", { mode: "relay" }, { "x-relayer-key": relayerKey });
    rec("S:op", res.status === 200, `the operator can still relay -> ${res.status}`);
  } else {
    rec("S:op", false, "RELAYER_KEY not in env, cannot prove the operator path");
  }

  console.log("\nREADS\n");
  const h = await get("/api/stock/health");
  rec("H", h.status === 200 && h.body.ok,
      `health ${h.status}: ` + Object.values(h.body.checks ?? {}).map((c) => c.detail).join(" | "));
  const st = await get(`/api/stock/state?address=${shopper.address}`);
  rec("B1", st.status === 200 && st.body.viewer?.address?.toLowerCase() === shopper.address.toLowerCase(),
      `the book belongs to the address asked for, ${st.body.loans?.length ?? 0} loans`);
  const anon = await get("/api/stock/state");
  rec("B1b", anon.status === 200 && anon.body.viewer?.address === null && (anon.body.loans ?? []).length === 0,
      "with no address: no book, no borrowed identity");

  const q = await post("/api/stock/quote", { shares: 10, tenorDays: 7 });
  const ceiling = (BigInt(q.body.collateralValue) * BigInt(q.body.ltvBps)) / 10000n;
  rec("B2", q.status === 200 && BigInt(q.body.maxBorrow) + BigInt(q.body.feeOnMax) <= ceiling,
      `${q.body.ltvBps}bps, principal+fee inside the ceiling`);
  for (const [id, body, want] of [
    ["B3", { shares: 0 }, /greater than zero/],
    ["B4", { shares: "abc" }, /greater than zero/],
    ["B5", { shares: 1, tenorDays: 3 }, /7 and 14/],
    ["F1", { shares: 1e30 }, /more shares than this market/],
  ]) {
    const r = await post("/api/stock/quote", body);
    rec(id, r.status === 400 && want.test(r.body.error ?? ""), `${r.status} — ${r.body.error}`);
  }
  const bad = await fetch(APP + "/api/stock/quote", {
    method: "POST", headers: { "content-type": "application/json" }, body: "not json",
  });
  rec("F1b", bad.status === 400, `a malformed body -> ${bad.status}, no parser internals`);

  console.log("\nSIGNED WRITES\n");
  const shares = ethers.parseUnits("2", 18);
  if ((await stock.balanceOf(shopper.address)) < shares) {
    await settled(await stock.connect(shopper).faucet(ethers.parseUnits("25", 18)));
  }
  if ((await stock.allowance(shopper.address, dep.contracts.engine)) < shares) {
    await settled(await stock.connect(shopper).approve(dep.contracts.engine, ethers.MaxUint256));
  }
  const q2 = await post("/api/stock/quote", { shares: 2, tenorDays: 7 });
  const ref = "verify-" + Date.now();
  const mBefore = await stable.balanceOf(merchant.address);
  await settled(
    await engine.connect(shopper).openLoan(
      dep.contracts.stock, shares, merchant.address, ethers.id(ref), BigInt(q2.body.maxBorrow), 7 * 86400
    )
  );
  const loanId = Number(await engine.loanCount()) - 1;
  const l = await engine.getLoan(loanId);
  rec("C1", l.borrower === shopper.address, `loan ${loanId}: the borrower is the signer, not a server key`);
  rec("C2", (await stable.balanceOf(merchant.address)) - mBefore === BigInt(q2.body.maxBorrow),
      "the merchant was paid exactly the quote");
  rec("C3", l.shares === shares, `${ethers.formatUnits(l.shares, 18)} shares locked`);

  let dup = false;
  try {
    await engine.connect(shopper).openLoan(
      dep.contracts.stock, shares, merchant.address, ethers.id(ref), BigInt(q2.body.maxBorrow), 7 * 86400
    );
  } catch (e) { dup = revertName(engine.interface, e) === "OrderAlreadyUsed"; }
  rec("C9", dup, "the same reference is refused on chain with OrderAlreadyUsed");

  const owed = await engine.amountOwed(loanId);
  if ((await stable.balanceOf(shopper.address)) < owed) await settled(await stable.mint(shopper.address, owed));
  if ((await stable.allowance(shopper.address, dep.contracts.engine)) < owed) {
    await settled(await stable.connect(shopper).approve(dep.contracts.engine, ethers.MaxUint256));
  }
  const sharesBefore = await stock.balanceOf(shopper.address);
  await settled(await engine.connect(shopper).repay(loanId));
  rec("C5",
    (await stock.balanceOf(shopper.address)) - sharesBefore === shares &&
      Number((await engine.getLoan(loanId)).status) === 2,
    "repaid under the borrower's own signature, every share back");

  let notYours = false;
  // The loan just repaid is closed, so a stranger repaying it would revert for
  // the wrong reason. Test the guard against a loan that is genuinely active.
  let activeId = -1;
  for (let i = Number(await engine.loanCount()) - 1; i >= 0 && activeId < 0; i--) {
    if (Number((await engine.getLoan(i)).status) === 1) activeId = i;
  }
  if (activeId >= 0) {
    try { await engine.connect(liquidator).repay.staticCall(activeId); }
    catch (e) { notYours = revertName(engine.interface, e) === "NotBorrower"; }
    rec("C10", notYours, `a stranger repaying active loan ${activeId} is refused with NotBorrower`);
  } else {
    rec("C10", false, "no active loan to test the borrower guard against");
  }

  console.log("\nINVARIANTS\n");
  const n = Number(await engine.loanCount());
  let ap = 0n, as = 0n;
  for (let i = 0; i < n; i++) {
    const x = await engine.getLoan(i);
    if (Number(x.status) === 1) { ap += x.principal; as += x.shares; }
  }
  rec("D2", (await pool.outstanding()) === ap, `pool.outstanding == sum(active principal) = ${ap}`);
  rec("D3", (await stock.balanceOf(dep.contracts.engine)) === as,
      `engine holds == sum(active shares) = ${ethers.formatUnits(as, 18)}`);

  const head = await ethers.provider.getBlockNumber();
  const logs = [];
  for (let to = head; to > head - 6000; to -= 100) {
    logs.push(...(await engine.queryFilter(engine.filters.LoanLiquidated(), Math.max(0, to - 99), to)));
    if (to - 100 <= 0) break;
  }
  let d1 = true;
  for (const ev of logs) {
    const x = await engine.getLoan(Number(ev.args.loanId));
    if (ev.args.sharesSeized + ev.args.sharesReturned !== x.shares) d1 = false;
  }
  rec("D1", d1, `${logs.length} liquidations, every one conserves shares`);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} pass`);
  const failed = results.filter((r) => !r.ok).map((r) => r.id);
  if (failed.length) { console.log("FAILED: " + failed.join(", ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
