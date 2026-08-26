#!/usr/bin/env node
/**
 * The runnable keeper.
 *
 *   pnpm --filter @polaris/keeper-solana doctor         check the setup
 *   pnpm --filter @polaris/keeper-solana collect        installments due now
 *   pnpm --filter @polaris/keeper-solana subscriptions  periods due now
 *   pnpm --filter @polaris/keeper-solana liquidate      loans past grace
 *   pnpm --filter @polaris/keeper-solana start          all three, in order
 *
 * Set KEEPER_DRY_RUN=true to simulate everything and send nothing. Every job
 * simulates first regardless — a dry run just stops before the send.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { PolarisKeeperClient } from "./client.ts";
import { loadConfig } from "./config.ts";
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
    default:
      console.error(`unknown command: ${cmd}`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
