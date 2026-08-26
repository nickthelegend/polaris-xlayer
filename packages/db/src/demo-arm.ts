/**
 * Bring a real plan's schedule forward so a demo can be recorded in one take.
 *
 * A BNPL plan is on a fortnightly cycle, and the contract will not accept an
 * interval under an hour, so a plan opened during a recording has nothing due
 * for at least an hour. Waiting is not an option on camera, and faking the
 * collection would make the recording worthless.
 *
 * What this does instead is move the plan's due dates into the past. Nothing
 * else is touched: the loan is a real loan on Sepolia, the money that moves is
 * real, and the keeper does the same simulate/execute/confirm it does in
 * production. Only the business calendar is shifted, which is exactly what
 * "this customer checked out a fortnight ago" means.
 *
 * It refuses to run against a plan that is not active, and it will not invent
 * one -- open a plan through the storefront first, so the thing on camera is
 * the thing the product actually does.
 *
 *   npm run demo:arm -- <loanId> [instalmentsDue]
 */

import { closeDb, getDb } from "./client.js";
import { formatUnits } from "./loanbook.js";

const HOUR_MS = 3_600_000;

const loanId = process.argv[2];
const due = Number(process.argv[3] ?? 1);

if (!loanId) {
  console.error("Usage: npm run demo:arm -- <loanId> [instalmentsDue]");
  process.exitCode = 2;
} else {
  try {
    const db = await getDb();
    const loans = db.collection("loans");
    const loan = await loans.findOne({ loanId });

    if (!loan) {
      throw new Error(`No loan ${loanId} in the book. Run \`npm run sync\` first.`);
    }
    if (loan.status !== "active") {
      throw new Error(
        `Loan ${loanId} is ${loan.status}. Arm an active plan -- open one through the storefront.`
      );
    }

    const schedule = loan.installments as Array<{
      index: number;
      dueAt: string | Date;
      amountRaw: string;
      state: string;
    }>;
    const pending = schedule.filter(
      (i) => i.state === "scheduled" || i.state === "dunning"
    );
    if (pending.length === 0) {
      throw new Error(`Loan ${loanId} has nothing left to collect.`);
    }

    /*
     * Shift the whole schedule by one offset rather than rewriting each date.
     * Keeping the spacing intact means the instalments that are not yet due
     * still fall an hour apart, so a second collection can be shown later in
     * the same session without arming the plan again.
     */
    const target = pending.at(Math.min(due, pending.length) - 1) ?? pending[0];
    const shiftMs =
      new Date((target as { dueAt: string | Date }).dueAt).getTime() -
      Date.now() +
      60_000;

    // Dates, not ISO strings. `dueInstallments` compares dueAt against a Date
    // with $lte, and BSON orders strings and dates as different types, so a
    // string here would silently match nothing and the demo would show an
    // empty pass.
    const shifted = schedule.map((i) => ({
      ...i,
      dueAt: new Date(new Date(i.dueAt).getTime() - shiftMs),
    }));

    await loans.updateOne({ loanId }, { $set: { installments: shifted } });

    const now = Date.now();
    console.log(`Loan ${loanId} armed. Schedule shifted back ${(shiftMs / HOUR_MS).toFixed(2)}h.\n`);
    for (const i of shifted) {
      const at = new Date(i.dueAt);
      const when = at.getTime() <= now
        ? "DUE NOW"
        : `in ${((at.getTime() - now) / 60_000).toFixed(0)}m`;
      const paid = i.state === "paid" ? " (paid)" : "";
      console.log(`  #${i.index}  ${formatUnits(BigInt(i.amountRaw), 6)}  ${when}${paid}`);
    }
    console.log("\nNext: cd keeper && npm run collect");
  } catch (err) {
    console.error(`Arm failed: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
