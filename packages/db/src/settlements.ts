/**
 * The settlement queue.
 *
 * `runSettlement` in the keeper existed but was fed a literal `[]`, so
 * `PolarisKeeper.settleMerchant` had never once executed and `totalSettled` was
 * permanently zero. This is the missing source: it derives what each merchant
 * is owed from instalments that have actually been collected and not yet paid
 * out.
 *
 * Settlement is tracked per instalment rather than per loan, because a BNPL
 * plan pays the merchant over weeks and a merchant should not wait for the
 * final instalment to see any of it.
 */

import { collections } from "./client.js";
import { formatUnits } from "./loanbook.js";

export type PendingSettlement = {
  merchantId: string;
  /** The merchant's payout address -- a recipient, never a call target. */
  payoutAddress: string;
  amountRaw: string;
  amountDisplay: string;
  orderId: string;
  details?: string;
  /** Which instalments this payout covers, so it can be marked settled after. */
  covers: Array<{ loanId: string; index: number }>;
};

/**
 * Everything collected but not yet paid out, grouped by merchant.
 *
 * Grouping matters: paying each instalment separately would mean one
 * transaction per instalment per merchant per cycle, which is the difference
 * between a handful of settlements a day and hundreds.
 */
export async function pendingSettlements(params: {
  chainId: number;
  /** Skip merchants owed less than this, to avoid uneconomic payouts. */
  minAmountRaw?: bigint;
}): Promise<PendingSettlement[]> {
  const { loans, merchants } = await collections();
  const min = params.minAmountRaw ?? 1_000_000n; // 1.00 by default

  const docs = await loans
    .find({ chainId: params.chainId, "installments.state": "paid" })
    .toArray();

  const byMerchant = new Map<
    string,
    { total: bigint; covers: PendingSettlement["covers"]; orderIds: string[] }
  >();

  for (const loan of docs) {
    for (const inst of loan.installments) {
      // `settledAt` absent means collected but never paid out.
      if (inst.state !== "paid") continue;
      if ((inst as { settledAt?: Date }).settledAt) continue;

      const entry = byMerchant.get(loan.merchantId) ?? {
        total: 0n,
        covers: [],
        orderIds: [],
      };
      entry.total += BigInt(inst.amountRaw);
      entry.covers.push({ loanId: loan.loanId, index: inst.index });
      if (!entry.orderIds.includes(loan.orderId)) entry.orderIds.push(loan.orderId);
      byMerchant.set(loan.merchantId, entry);
    }
  }

  const out: PendingSettlement[] = [];
  for (const [merchantId, entry] of byMerchant) {
    if (entry.total < min) continue;

    const merchant = await merchants.findOne({ merchantId });
    if (!merchant?.payoutAddress) continue;

    out.push({
      merchantId,
      payoutAddress: merchant.payoutAddress,
      amountRaw: entry.total.toString(),
      amountDisplay: `${formatUnits(entry.total, 6)} USDC`,
      // One payout can cover several orders; the reference names all of them so
      // a merchant can reconcile a lump sum back to individual sales.
      orderId: entry.orderIds.slice(0, 5).join(","),
      details: `${entry.covers.length} instalment(s) across ${entry.orderIds.length} order(s)`,
      covers: entry.covers,
    });
  }

  return out;
}

/** Mark instalments settled and credit the merchant's running total. */
export async function markSettled(
  settlement: PendingSettlement,
  transactionHash?: string
): Promise<void> {
  const { loans, merchants, events } = await collections();
  const now = new Date();

  for (const c of settlement.covers) {
    await loans.updateOne(
      { loanId: c.loanId },
      { $set: { "installments.$[el].settledAt": now, updatedAt: now } },
      { arrayFilters: [{ "el.index": c.index }] }
    );
  }

  const merchant = await merchants.findOne({ merchantId: settlement.merchantId });
  const previous = BigInt(merchant?.totalSettled ?? "0");
  await merchants.updateOne(
    { merchantId: settlement.merchantId },
    {
      $set: {
        totalSettled: (previous + BigInt(settlement.amountRaw)).toString(),
        updatedAt: now,
      },
    }
  );

  await events.insertOne({
    type: "settlement.paid",
    merchantId: settlement.merchantId,
    chainId: merchant?.chainId ?? 0,
    transactionHash,
    payload: {
      amountRaw: settlement.amountRaw,
      instalments: settlement.covers.length,
      orderIds: settlement.orderId,
    },
    createdAt: now,
  });
}
