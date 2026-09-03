/**
 * D1-D5: read the chain and check the things that must always be true,
 * across every loan the engine has ever written — not just one account's.
 */
const { ethers, network } = require("hardhat");
const fs = require("fs"); const path = require("path");

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `polaris-${network.name}.json`), "utf8"));
  const engine = await ethers.getContractAt("PolarisEngine", dep.contracts.engine);
  const pool = await ethers.getContractAt("LiquidityPool", dep.contracts.pool);
  const stock = await ethers.getContractAt("TestnetStock", dep.contracts.stock);

  const n = Number(await engine.loanCount());
  let activePrincipal = 0n, activeShares = 0n, fails = 0;
  const ltv = await engine.maxLtvBps();
  const rows = [];

  for (let i = 0; i < n; i++) {
    const l = await engine.getLoan(i);
    rows.push({ id: i, status: Number(l.status), shares: l.shares, principal: l.principal, fee: l.fee });
    if (Number(l.status) === 1) {
      activePrincipal += l.principal;
      activeShares += l.shares;
      // D4: debt at origination never exceeded the ceiling at the opening price
      const value = await engine.collateralValueOf(l.stock, l.shares, l.openPrice);
      const ceiling = (value * (l.openedWhileClosed
        ? (ltv * (10000n - (await engine.closedMarketHaircutBps()))) / 10000n
        : ltv)) / 10000n;
      const debt = l.principal + l.fee;
      const ok = debt <= ceiling;
      if (!ok) { fails++; console.log(`  D4 FAIL loan ${i}: debt ${debt} > ceiling ${ceiling}`); }
    }
  }

  const outstanding = await pool.outstanding();
  const held = await stock.balanceOf(dep.contracts.engine);

  const check = (name, a, b) => {
    const ok = a === b;
    if (!ok) fails++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}: ${a} ${ok ? "==" : "!="} ${b}`);
  };

  console.log(`${n} loans on chain\n`);
  console.log("D2 pool accounting");
  check("pool.outstanding == sum(principal of Active)", outstanding, activePrincipal);
  console.log("D3 no orphan collateral");
  check("engine share balance == sum(shares of Active)", held, activeShares);
  console.log("D4 LTV honoured at origination — checked per active loan above");
  console.log(`  ${fails === 0 ? "PASS" : "FAIL"}  every active loan within its opening ceiling`);

  // D1: conservation on every liquidation, from the events themselves
  console.log("D1 conservation on liquidation");

  /*
   * How far back to look is not a guess.
   *
   * This walked back a fixed 5000 blocks, which on X Layer is about three
   * hours — so the moment a liquidation aged past that it vanished from the
   * check and the script cheerfully reported "no liquidations yet on this
   * deployment" while four sat in state. An invariant that stops watching is
   * not an invariant.
   *
   * The loan book says how many liquidations there should be, so the search
   * pages back until it has found all of them and then stops. Exhaustive when
   * it needs to be, and no slower than before when nothing has been
   * liquidated recently.
   */
  const total = Number(await engine.loanCount());
  const expected = [];
  for (let i = 0; i < total; i++) {
    const l = await engine.getLoan(i);
    if (Number(l.status) === 3) expected.push(i); // Status.Liquidated
  }

  const head = await ethers.provider.getBlockNumber();
  const WINDOW = 100; // X Layer refuses a log query spanning more than this
  const found = new Map();
  for (let to = head; to >= 0 && found.size < expected.length; to -= WINDOW) {
    const from = Math.max(0, to - WINDOW + 1);
    const batch = await engine.queryFilter(engine.filters.LoanLiquidated(), from, to);
    for (const ev of batch) found.set(Number(ev.args.loanId), ev);
    if (from === 0) break;
  }

  if (expected.length === 0) {
    console.log("  (no liquidations in the loan book)");
  } else {
    for (const id of expected) {
      const ev = found.get(id);
      if (!ev) {
        // Say so rather than passing by omission.
        console.log(`  FAIL  loan ${id} is Liquidated but its event was not found`);
        fails += 1;
        continue;
      }
      const l = await engine.getLoan(id);
      check(`loan ${id}: seized + returned == locked`, ev.args.sharesSeized + ev.args.sharesReturned, l.shares);
    }
  }

  console.log(`\n${fails === 0 ? "ALL INVARIANTS HOLD" : fails + " INVARIANT FAILURES"}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
