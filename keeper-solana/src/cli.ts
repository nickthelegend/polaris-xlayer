#!/usr/bin/env node
/**
 * The runnable keeper.
 *
 *   pnpm --filter @polaris/keeper-solana doctor         check the setup
 *   pnpm --filter @polaris/keeper-solana collect        installments due now
 *   pnpm --filter @polaris/keeper-solana subscriptions  periods due now
 *   pnpm --filter @polaris/keeper-solana liquidate      loans past grace
 *   pnpm --filter @polaris/keeper-solana start          all three, in order
 *   pnpm --filter @polaris/keeper-solana watch          all three, forever
 *
 * Set KEEPER_DRY_RUN=true to simulate everything and send nothing. Every job
 * simulates first regardless — a dry run just stops before the send.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { PolarisKeeperClient } from "./client.ts";
import { assertDeployed, loadConfig, type KeeperConfig } from "./config.ts";
import { formatUsdc } from "./book.ts";
import { runCollection, runLiquidation, runSubscriptions, type JobResult } from "./jobs.ts";

const here = dirname(fileURLToPath(import.meta.url));
const IDL = JSON.parse(readFileSync(resolve(here, "../../target/idl/polaris.json"), "utf8"));

function report(r: JobResult) {
  console.log(
    `\n  ${r.job}: ${r.considered} due · ${r.succeeded} collected · ${r.failed} failed · ${r.skipped} skipped`,
  );
  if (r.notifications.length) {
    console.log(`  ${r.notifications.length} borrower notification(s) queued`);
  }
}

async function doctor() {
  const cfg = loadConfig(IDL);
  console.log(`cluster            ${cfg.cluster}`);
  console.log(`rpc                ${cfg.connection.rpcEndpoint}`);
  console.log(`program            ${cfg.programId.toBase58()}`);
  console.log(`keeper             ${cfg.keeper.publicKey.toBase58()}`);

  const balance = await cfg.connection.getBalance(cfg.keeper.publicKey);
  const sol = balance / LAMPORTS_PER_SOL;
  console.log(`keeper balance     ${sol.toFixed(4)} SOL`);
  if (sol < 0.05) {
    console.log(`  ⚠ low. The keeper pays every transaction fee; top it up.`);
  }

  const programInfo = await cfg.connection.getAccountInfo(cfg.programId);
  console.log(`program deployed   ${programInfo ? "yes" : "NO — deploy it first"}`);

  try {
    const p: any = await (cfg.program.account as any).protocol.fetch(cfg.pdas.protocol);
    console.log(`protocol           initialized`);
    console.log(`  stablecoin       ${p.stablecoin.toBase58()}`);
    console.log(`  grace period     ${p.gracePeriod.toString()}s`);
    console.log(`  loans            ${p.loanCount.toString()}`);
    console.log(`  plans            ${p.planCount.toString()}`);
    console.log(`  fees accrued     ${formatUsdc(BigInt(p.protocolFeesAccrued.toString()))}`);
    console.log(`  bad debt         ${formatUsdc(BigInt(p.badDebt.toString()))}`);

    const vault = await cfg.connection.getTokenAccountBalance(cfg.pdas.liquidityVault);
    console.log(`  liquidity        ${vault.value.uiAmountString} USDC`);
  } catch {
    console.log(`protocol           NOT initialized at ${cfg.pdas.protocol.toBase58()}`);
  }

  console.log(`dry run            ${cfg.dryRun}`);
}

async function main() {
  const cmd = process.argv[2] ?? "doctor";

  if (cmd === "doctor") return doctor();

  const cfg = loadConfig(IDL);
  /*
   * Before any pass. A wrong-cluster keeper reporting "0 due" is worse than
   * one that refuses to start.
   *
   * `watch` checks this inside its own loop instead. Failing fast is right for
   * a command you are watching run, and wrong for a service: an rpc that is
   * down for the few seconds it takes a validator to come up would kill the
   * keeper at boot, and under a supervisor that is a crash loop rather than a
   * keeper that waits and carries on.
   */
  if (cmd !== "watch") await assertDeployed(cfg);
  const client = new PolarisKeeperClient(cfg.connection, cfg.keeper);
  const ctx = { cfg, client };

  if (cfg.dryRun) console.log("DRY RUN — simulating everything, sending nothing.\n");

  switch (cmd) {
    case "collect":
      report(await runCollection(ctx));
      break;
    case "subscriptions":
      report(await runSubscriptions(ctx));
      break;
    case "liquidate":
      report(await runLiquidation(ctx));
      break;
    case "all":
      // Order matters: collect before liquidating, so a borrower who pays on
      // the last day of grace is never liquidated by our own pass ordering.
      report(await runCollection(ctx));
      report(await runSubscriptions(ctx));
      report(await runLiquidation(ctx));
      break;
    case "watch":
      await watch(ctx);
      break;
    default:
      console.error(`unknown command: ${cmd}`);
      process.exit(1);
  }
}

/**
 * Run the crank forever.
 *
 * The whole claim this project makes about Solana is that the keeper stops
 * being an execution platform and becomes a cron job. A `watch` command is
 * what makes that literally true — and it is the difference between a demo
 * where somebody triggers a collection by hand and one where the money simply
 * moves while everyone watches.
 */
async function watch(ctx: { cfg: KeeperConfig; client: PolarisKeeperClient }) {
  const seconds = ctx.cfg.intervalSeconds;
  let stopping = false;
  let passes = 0;

  /*
   * Waking the sleep is the whole point of this handle.
   *
   * Without it a stop request is only noticed when the interval elapses, so a
   * keeper on a five minute cycle looks hung for up to five minutes after
   * Ctrl-C and gets SIGKILLed by any supervisor with a shutdown timeout. The
   * pass in flight is still allowed to finish -- that part is deliberate,
   * because abandoning a pass midway can leave a collection unconfirmed.
   */
  let wake: (() => void) | null = null;

  const stop = () => {
    if (stopping) process.exit(0);
    stopping = true;
    console.log("\n  finishing this pass, then stopping. Ctrl-C again to quit now.");
    wake?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log(`watching · every ${seconds}s · Ctrl-C to stop\n`);

  /*
   * Re-checked after any failed pass rather than once at boot, so a program
   * redeployed or an rpc replaced under a running keeper is noticed.
   */
  let verified = false;

  while (!stopping) {
    const started = Date.now();
    passes += 1;
    try {
      if (!verified) {
        await assertDeployed(ctx.cfg);
        verified = true;
      }
      /*
       * Order matters, exactly as it does for a single pass: collect before
       * liquidating, so a borrower who pays on the last day of grace is never
       * liquidated by our own pass ordering.
       */
      const collection = await runCollection(ctx);
      const subscriptions = await runSubscriptions(ctx);
      const liquidation = await runLiquidation(ctx);

      const did = collection.succeeded + subscriptions.succeeded + liquidation.succeeded;
      const failed = collection.failed + subscriptions.failed + liquidation.failed;

      // A quiet pass is the normal case and should not scroll the useful ones
      // off the screen. Only say something when something happened.
      if (did > 0 || failed > 0) {
        report(collection);
        report(subscriptions);
        report(liquidation);
      } else {
        process.stdout.write(`  pass ${passes}: nothing due\r`);
      }
    } catch (e) {
      /*
       * A pass that throws must not end the service. An RPC that is briefly
       * unreachable is the most likely cause, and a keeper that exits on it
       * stops collecting for everybody until somebody notices.
       */
      verified = false;
      console.error(`  pass ${passes} failed: ${e instanceof Error ? e.message : e}`);
    }

    if (stopping) break;
    const elapsed = Date.now() - started;
    await sleepUntil(Math.max(0, seconds * 1000 - elapsed), (w) => {
      wake = w;
    });
    wake = null;
  }

  /*
   * Hand the signals back before saying we stopped.
   *
   * A registered signal listener is a ref'd libuv handle, so node keeps the
   * event loop alive for as long as one exists — the loop would exit, print
   * this line, and then sit there forever. Under systemd or docker that reads
   * as a service that ignores SIGTERM, and every restart waits out the kill
   * timeout before the process is shot. Removing them lets the process end on
   * its own once nothing else is pending, which is also the honest signal:
   * if it still does not exit, something really is unfinished.
   */
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);

  console.log(`\nstopped after ${passes} ${passes === 1 ? "pass" : "passes"}.`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A sleep that can be cut short, handing its resolver to the caller.
 *
 * `unref` is not enough on its own here -- an unref'd timer lets the process
 * exit but does not resolve the await, so the loop would still be parked.
 */
export function sleepUntil(ms: number, hand: (wake: () => void) => void): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    hand(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
