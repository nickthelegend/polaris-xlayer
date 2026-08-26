/**
 * Seed a demo merchant and a spread of payment plans.
 *
 *   node --experimental-strip-types src/seed.ts
 *
 * The plans deliberately cover every state the keeper and the ledger have to
 * render: one collecting cleanly, one mid-dunning, one about to be liquidated,
 * one fully repaid. A demo that only shows the happy path proves nothing.
 */

import { createHash, randomUUID } from "node:crypto";

import { closeDb, collections, ensureIndexes } from "./client.js";
import { buildInstallments } from "./loanbook.js";
import type { LoanDoc, MerchantDoc } from "./schema.js";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11_155_111);
const MERCHANT_ID = "merch_demo_polaris";
const MERCHANT_WALLET = "0x7a2e11b3ecebab8ea46966edadd4092583809b67";
const DAY = 86_400_000;

const usdc = (n: number) => BigInt(Math.round(n * 1e6));

function plan(params: {
  loanId: string;
  orderId: string;
  borrower: string;
  principal: number;
  count: number;
  startedDaysAgo: number;
  status?: LoanDoc["status"];
  paidThrough?: number;
  dunningAt?: number;
  attempts?: number;
  liquidationCandidate?: boolean;
}): LoanDoc {
  const startAt = new Date(Date.now() - params.startedDaysAgo * DAY);
  const totalOwed = usdc(params.principal * 1.02);
  const installments = buildInstallments({
    totalOwedRaw: totalOwed,
    count: params.count,
    intervalSeconds: 14 * 86_400,
    startAt,
  });

  let repaid = 0n;
  for (const inst of installments) {
    if (inst.index <= (params.paidThrough ?? 0)) {
      inst.state = "paid";
      inst.attempts = 1;
      inst.paidAt = new Date(inst.dueAt.getTime() + 3_600_000);
      inst.transactionHash = `0x${createHash("sha256")
        .update(`${params.loanId}-${inst.index}`)
        .digest("hex")}`;
      repaid += BigInt(inst.amountRaw);
    } else if (inst.index === params.dunningAt) {
      inst.state = "dunning";
      inst.attempts = params.attempts ?? 2;
      inst.lastFailureKind = "insufficient_funds";
      inst.nextAttemptAt = new Date(Date.now() + 6 * 3_600_000);
    }
  }

  return {
    loanId: params.loanId,
    chainId: CHAIN_ID,
    borrower: params.borrower,
    merchantId: MERCHANT_ID,
    orderId: params.orderId,
    principalRaw: usdc(params.principal).toString(),
    totalOwedRaw: totalOwed.toString(),
    totalRepaidRaw: repaid.toString(),
    status: params.status ?? "active",
    installments,
    liquidationCandidate: params.liquidationCandidate ?? false,
    creditScoreAtOrigination: 600 + Number(params.loanId) * 7,
    createdAt: startAt,
    updatedAt: new Date(),
  };
}

try {
  await ensureIndexes();
  const { merchants, loans, receipts, events } = await collections();

  const merchant: MerchantDoc = {
    merchantId: MERCHANT_ID,
    name: "Polaris Demo Store",
    walletAddress: MERCHANT_WALLET,
    payoutAddress: MERCHANT_WALLET,
    apiKeyHash: createHash("sha256").update(`pk_demo_${randomUUID()}`).digest("hex"),
    status: "active",
    maxOrderValue: usdc(5000).toString(),
    // Zero, not 1840. The merchant dashboard renders this straight through as
    // "Settled to you", so a seeded figure presented an invented payout as
    // money that had actually reached the merchant. Settlement totals should
    // only ever be what the protocol really transferred.
    totalSettled: "0",
    chainId: CHAIN_ID,
    createdAt: new Date(Date.now() - 60 * DAY),
    updatedAt: new Date(),
  };

  await merchants.updateOne(
    { merchantId: MERCHANT_ID },
    { $set: merchant },
    { upsert: true }
  );

  const docs: LoanDoc[] = [
    plan({
      loanId: "1",
      orderId: "PLR-1042",
      borrower: "0x1111111111111111111111111111111111111111",
      principal: 200,
      count: 4,
      startedDaysAgo: 30,
      paidThrough: 2,
    }),
    plan({
      loanId: "2",
      orderId: "PLR-1043",
      borrower: "0x2222222222222222222222222222222222222222",
      principal: 120,
      count: 4,
      startedDaysAgo: 45,
      paidThrough: 1,
      dunningAt: 2,
      attempts: 3,
    }),
    plan({
      loanId: "3",
      orderId: "PLR-1044",
      borrower: "0x3333333333333333333333333333333333333333",
      principal: 480,
      count: 6,
      startedDaysAgo: 90,
      paidThrough: 2,
      dunningAt: 3,
      attempts: 5,
      liquidationCandidate: true,
    }),
    plan({
      loanId: "4",
      orderId: "PLR-1039",
      borrower: "0x4444444444444444444444444444444444444444",
      principal: 75,
      count: 3,
      startedDaysAgo: 120,
      paidThrough: 3,
      status: "repaid",
    }),
    plan({
      loanId: "5",
      orderId: "PLR-1031",
      borrower: "0x5555555555555555555555555555555555555555",
      principal: 300,
      count: 4,
      startedDaysAgo: 150,
      paidThrough: 1,
      status: "liquidated",
    }),
  ];

  for (const doc of docs) {
    await loans.updateOne(
      { loanId: doc.loanId, chainId: doc.chainId },
      { $set: doc },
      { upsert: true }
    );
  }

  const counts = {
    merchants: await merchants.countDocuments(),
    loans: await loans.countDocuments(),
    receipts: await receipts.countDocuments(),
    events: await events.countDocuments(),
  };

  console.log("Seeded PolarisPay demo data\n");
  console.log(`  merchant   ${MERCHANT_ID} (${MERCHANT_WALLET})`);
  console.log(`  plans      ${docs.length} across collecting / dunning / liquidation / repaid`);
  console.log(`  chain      ${CHAIN_ID}\n`);
  console.log(`  collection counts: ${JSON.stringify(counts)}`);
} catch (err) {
  console.error(`Seed failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
