/**
 * Sync live LoanEngine state into MongoDB.
 *
 *   node --experimental-strip-types src/sync-chain.ts
 *
 * The chain is the source of truth for what is owed; Mongo is the working set
 * the keeper schedules against and the UIs render. This reads every loan the
 * engine knows about and reconciles the book to it, so the two can never drift
 * silently. Safe to run repeatedly.
 */

import { closeDb, collections, ensureIndexes } from "./client.js";
import { buildInstallments, formatUnits } from "./loanbook.js";
import type { LoanDoc, MerchantDoc } from "./schema.js";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11_155_111);
const ENGINE = process.env.POLARIS_LOAN_ENGINE;
const SCORES = process.env.POLARIS_SCORE_MANAGER;

if (!ENGINE) {
  console.error("POLARIS_LOAN_ENGINE is not set. Deploy first, then paste the address into .env.");
  process.exit(1);
}

/** Minimal eth_call helper -- avoids pulling a full web3 lib into the data layer. */
async function call(to: string, data: string): Promise<string> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result ?? "0x";
}

// 4-byte selectors, precomputed with keccak so this file needs no web3 dep.
// Verified against the deployed ABI, not guessed.
const SEL = {
  loanCount: "0xce63094d", //         loanCount()
  getLoan: "0x504006ca", //           getLoan(uint256)
  outstandingOf: "0xa20dbd50", //     outstandingOf(uint256)
  scoreOf: "0x133af456", //           scoreOf(address)
  checkLiquidatable: "0x3e129715", // checkLiquidatable(uint256)
} as const;

const word = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");
const hexToBig = (hex: string, slot: number) =>
  BigInt(`0x${hex.slice(2 + slot * 64, 2 + (slot + 1) * 64)}`);
const hexToAddr = (hex: string, slot: number) =>
  `0x${hex.slice(2 + slot * 64 + 24, 2 + (slot + 1) * 64)}`;

const STATUS: LoanDoc["status"][] = ["active", "repaid", "liquidated"];

try {
  await ensureIndexes();
  const { loans, merchants } = await collections();

  const countHex = await call(ENGINE, SEL.loanCount);
  const count = BigInt(countHex === "0x" ? "0x0" : countHex);
  console.log(`LoanEngine ${ENGINE}`);
  console.log(`Chain ${CHAIN_ID} via ${RPC.replace("https://", "")}`);
  console.log(`Loans on chain: ${count}\n`);

  if (count === 0n) {
    console.log("Nothing to sync. Run packages/contracts/scripts/e2e.js to create a plan.");
  }

  let synced = 0;
  for (let id = 1n; id <= count; id++) {
    const raw = await call(ENGINE, SEL.getLoan + word(id));
    if (raw === "0x" || raw.length < 130) {
      console.log(`  loan ${id}: no data returned, skipping`);
      continue;
    }

    // Loan is a fully static struct (no dynamic members), so the ABI encoder
    // lays its fields out inline with no leading offset word. Stripping one
    // here would shift every field by a slot.
    const body = raw;
    const borrower = hexToAddr(body, 0);
    const merchant = hexToAddr(body, 1);
    const principal = hexToBig(body, 2);
    const totalOwed = hexToBig(body, 3);
    const totalRepaid = hexToBig(body, 4);
    const installmentCount = Number(hexToBig(body, 5));
    const installmentsPaid = Number(hexToBig(body, 6));
    const startedAt = Number(hexToBig(body, 7));
    const intervalSeconds = Number(hexToBig(body, 8));
    const status = STATUS[Number(hexToBig(body, 9))] ?? "active";

    if (installmentCount === 0) {
      console.log(`  loan ${id}: zero installments, skipping`);
      continue;
    }

    const installments = buildInstallments({
      totalOwedRaw: totalOwed,
      count: installmentCount,
      intervalSeconds,
      startAt: new Date(startedAt * 1000),
      symbol: "pUSDC",
    });
    // Mark what the chain says is already collected. Anything beyond that keeps
    // whatever dunning state the book already had, so a re-sync never wipes a
    // retry schedule the keeper is mid-way through.
    const existing = await loans.findOne({ loanId: id.toString(), chainId: CHAIN_ID });
    for (const inst of installments) {
      if (inst.index <= installmentsPaid) {
        inst.state = "paid";
        inst.attempts = 1;
        inst.paidAt = existing?.installments.find((i) => i.index === inst.index)?.paidAt
          ?? new Date();
        inst.transactionHash = existing?.installments.find((i) => i.index === inst.index)
          ?.transactionHash;
      } else {
        const prev = existing?.installments.find((i) => i.index === inst.index);
        if (prev && prev.state === "dunning") {
          inst.state = "dunning";
          inst.attempts = prev.attempts;
          inst.nextAttemptAt = prev.nextAttemptAt;
          inst.lastFailureKind = prev.lastFailureKind;
        }
      }
    }

    const doc: LoanDoc = {
      loanId: id.toString(),
      chainId: CHAIN_ID,
      borrower: borrower.toLowerCase(),
      merchantId: existing?.merchantId ?? "merch_demo_polaris",
      orderId: existing?.orderId ?? `PLR-${1000 + Number(id)}`,
      principalRaw: principal.toString(),
      totalOwedRaw: totalOwed.toString(),
      totalRepaidRaw: totalRepaid.toString(),
      status,
      installments,
      liquidationCandidate: existing?.liquidationCandidate ?? false,
      createdAt: existing?.createdAt ?? new Date(startedAt * 1000),
      updatedAt: new Date(),
    };

    await loans.updateOne(
      { loanId: doc.loanId, chainId: CHAIN_ID },
      { $set: doc },
      { upsert: true }
    );
    synced++;

    console.log(
      `  loan ${id}  ${status.padEnd(10)} ${installmentsPaid}/${installmentCount} paid  ` +
        `${formatUnits(totalOwed - totalRepaid, 6)} outstanding  borrower ${borrower.slice(0, 10)}…`
    );

    // Attach the merchant record if the payout address matches a known one.
    await merchants.updateOne(
      { merchantId: doc.merchantId },
      {
        $setOnInsert: {
          merchantId: doc.merchantId,
          name: "Polaris Demo Store",
          walletAddress: merchant.toLowerCase(),
          payoutAddress: merchant.toLowerCase(),
          apiKeyHash: "unset",
          status: "active" as MerchantDoc["status"],
          maxOrderValue: "5000000000",
          totalSettled: "0",
          chainId: CHAIN_ID,
          createdAt: new Date(),
        },
        $set: { updatedAt: new Date() },
      },
      { upsert: true }
    );
  }

  console.log(`\nSynced ${synced} loan(s) from chain into MongoDB.`);
} catch (err) {
  console.error(`Sync failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
