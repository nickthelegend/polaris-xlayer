/**
 * The liquidation keeper.
 *
 * `isLiquidatable` and `liquidate` are a check-and-execute pair, and on an EVM
 * the check is a `require` on the line above the action, so there is no window
 * between them for a last-second repayment to be liquidated on a stale read.
 * That makes this a scheduler rather than an execution layer: its only job is
 * to notice and to send.
 *
 * It liquidates with its own stablecoin and takes the collateral plus the
 * bonus, exactly as any third-party liquidator would — there is no privileged
 * path. If nobody runs this, the incentive is still there for someone else.
 *
 *   npx hardhat run scripts/keeper.js --network xlayerTestnet
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const EVERY_MS = Number(process.env.KEEPER_INTERVAL_MS || 30_000);
const DRY_RUN = process.env.KEEPER_DRY_RUN === "1";

async function main() {
  const file = path.join(__dirname, "..", "deployments", `polaris-${network.name}.json`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const engine = await ethers.getContractAt("PolarisEngine", dep.contracts.engine);
  const stable = await ethers.getContractAt("MockUSDC", dep.contracts.stable);
  const [signer] = await ethers.getSigners();
  console.log(`keeper ${signer.address}${DRY_RUN ? "  (dry run)" : ""}\nengine ${dep.contracts.engine}\n`);

  const sweep = async () => {
    const n = Number(await engine.loanCount());
    let active = 0;
    for (let id = 0; id < n; id++) {
      const l = await engine.getLoan(id);
      if (Number(l.status) !== 1) continue; // not Active
      active++;
      let due;
      try {
        due = await engine.isLiquidatable(id);
      } catch (e) {
        // A stale price makes the position unreadable, not liquidatable. The
        // relayer's problem, not ours — say so rather than guessing.
        console.log(`  loan ${id}: cannot price (${(e.shortMessage || e.message).slice(0, 60)})`);
        continue;
      }
      if (!due) continue;

      const owed = await engine.amountOwed(id);
      const bal = await stable.balanceOf(signer.address);
      console.log(`  loan ${id} liquidatable — owes ${owed}, keeper holds ${bal}`);
      if (DRY_RUN) continue;
      if (bal < owed) {
        console.log(`  loan ${id}: keeper underfunded, leaving it for another liquidator`);
        continue;
      }
      const allowance = await stable.allowance(signer.address, dep.contracts.engine);
      if (allowance < owed) await (await stable.approve(dep.contracts.engine, ethers.MaxUint256)).wait();
      const tx = await engine.liquidate(id);
      await tx.wait();
      console.log(`  loan ${id} liquidated — tx ${tx.hash}`);
    }
    console.log(`${new Date().toISOString()}  swept ${n} loans, ${active} active`);
  };

  await sweep();
  if (process.env.KEEPER_ONCE === "1") return;
  setInterval(sweep, EVERY_MS);
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
