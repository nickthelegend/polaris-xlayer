/**
 * Mongo-backed LoanBook and ReceiptStore.
 *
 * Same interfaces the keeper already targets, so swapping the file-backed
 * implementation for this one is a one-line change in the keeper's wiring.
 */

import { collections } from "./client.js";
import type {
  InstallmentDoc,
  InstallmentState,
  LoanDoc,
  ReceiptDoc,
} from "./schema.js";

export type BookLoan = {
  loanId: string;
  borrower: string;
  merchantId?: string;
  liquidationCandidate?: boolean;
  installments: Array<{
    index: number;
    dueAt: string;
    amountRaw: string;
    amountDisplay: string;
    // The union, not a bare string: the keeper branches on these values, and a
    // widened type here is what forced a cast at the keeper boundary.
    state: InstallmentState;
    attempts: number;
    nextAttemptAt?: string;
    lastFailureKind?: string;
  }>;
};

function toBookLoan(doc: LoanDoc): BookLoan {
  return {
    loanId: doc.loanId,
    borrower: doc.borrower,
    merchantId: doc.merchantId,
    liquidationCandidate: doc.liquidationCandidate,
    installments: doc.installments.map((i) => ({
      index: i.index,
      dueAt: i.dueAt.toISOString(),
      amountRaw: i.amountRaw,
      amountDisplay: i.amountDisplay,
      state: i.state,
      attempts: i.attempts,
      nextAttemptAt: i.nextAttemptAt?.toISOString(),
      lastFailureKind: i.lastFailureKind,
    })),
  };
}

/**
 * The loan's repaid total after collecting one instalment.
 *
 * Split out and exported because getting this wrong is expensive in both
 * directions: undercount and the borrower is told they owe money they have
 * already paid, overcount and the protocol writes off debt nobody settled.
 *
 * The cap matters on the final instalment. Instalment amounts are the total
 * divided into equal parts and rounded up, so the parts can sum to slightly
 * more than the total -- crediting the raw amount would leave the book
 * claiming a loan was overpaid.
 */
export function repaidAfterCollecting(loan: {
  totalOwedRaw: string;
  totalRepaidRaw: string;
  amountRaw: string;
}): string {
  const owed = BigInt(loan.totalOwedRaw);
  const repaid = BigInt(loan.totalRepaidRaw);
  const room = owed > repaid ? owed - repaid : 0n;
  const amount = BigInt(loan.amountRaw);
  return (repaid + (amount > room ? room : amount)).toString();
}

export class MongoLoanBook {
  async dueInstallments(
    now: Date
  ): Promise<Array<{ loan: BookLoan; installment: BookLoan["installments"][number] }>> {
    const { loans } = await collections();

    // Filter on the server: an elemMatch narrows to loans with at least one
    // collectable installment, so we never pull the whole active book into
    // memory just to discard most of it.
    const docs = await loans
      .find({
        status: "active",
        installments: {
          $elemMatch: {
            state: { $in: ["scheduled", "dunning"] },
            dueAt: { $lte: now },
          },
        },
      })
      .toArray();

    const out: Array<{ loan: BookLoan; installment: BookLoan["installments"][number] }> = [];
    for (const doc of docs) {
      const loan = toBookLoan(doc);
      for (const inst of loan.installments) {
        if (inst.state !== "scheduled" && inst.state !== "dunning") continue;
        if (new Date(inst.dueAt) > now) continue;
        // Honour the dunning back-off. This cannot be pushed into the query
        // above because elemMatch already selected the loan, not the element.
        if (inst.nextAttemptAt && new Date(inst.nextAttemptAt) > now) continue;
        out.push({ loan, installment: inst });
      }
    }
    return out;
  }

  async liquidationCandidates(): Promise<BookLoan[]> {
    const { loans } = await collections();
    const docs = await loans
      .find({ liquidationCandidate: true, status: "active" })
      .toArray();
    return docs.map(toBookLoan);
  }

  async recordAttempt(
    loanId: string,
    index: number,
    patch: Partial<{
      state: InstallmentState;
      attempts: number;
      nextAttemptAt?: string;
      lastFailureKind?: string;
      transactionHash?: string;
    }>
  ): Promise<void> {
    const { loans } = await collections();
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const unset: Record<string, ""> = {};

    for (const [key, value] of Object.entries(patch)) {
      const path = `installments.$[el].${key}`;
      if (value === undefined) {
        unset[path] = "";
        continue;
      }
      set[path] =
        key === "nextAttemptAt" ? new Date(value as string) : value;
    }
    if (patch.state === "paid") {
      set["installments.$[el].paidAt"] = new Date();
    }

    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;

    // A plain updateOne is enough for anything but a collection.
    if (patch.state !== "paid") {
      await loans.updateOne({ loanId }, update, { arrayFilters: [{ "el.index": index }] });
      return;
    }

    // Move the loan total in the same write that marks the instalment paid.
    //
    // This used to be left to the chain sync, which meant that between a
    // collection and the next sync the book disagreed with itself: instalments
    // marked paid, totalRepaidRaw unmoved. Everything derived from the loan
    // total inherited the error -- the borrower's dashboard overstated their
    // debt by the amount just collected and withheld the credit they had just
    // freed up. Being told you still owe money you have already paid is the one
    // thing a credit product must never do.
    const doc = await loans.findOne(
      { loanId },
      { projection: { installments: 1, totalOwedRaw: 1, totalRepaidRaw: 1 } }
    );
    const inst = doc?.installments.find((i) => i.index === index);
    if (!doc || !inst) return;

    if (inst.state !== "paid") {
      const repaid = repaidAfterCollecting({
        totalOwedRaw: doc.totalOwedRaw,
        totalRepaidRaw: doc.totalRepaidRaw,
        amountRaw: inst.amountRaw,
      });
      set.totalRepaidRaw = repaid;

      // Close the loan on the last instalment. The contract flips its own
      // status once the debt is cleared, and a book that leaves it "active"
      // keeps the plan on the borrower's dashboard, keeps it in the settlement
      // and liquidation candidate queries, and keeps its collateral looking
      // locked -- all for a loan that is finished.
      if (BigInt(repaid) >= BigInt(doc.totalOwedRaw)) {
        set.status = "repaid";
        set.closedAt = new Date();
      }
    }

    // Requiring the instalment to still be unpaid makes this compare-and-swap:
    // a retry that races another writer onto the same instalment matches
    // nothing and so cannot count the payment twice.
    const result = await loans.updateOne(
      { loanId, installments: { $elemMatch: { index, state: { $ne: "paid" } } } },
      update,
      { arrayFilters: [{ "el.index": index }] }
    );

    // It was already paid. Still record the transaction hash and attempt count,
    // which are facts about this attempt, without touching the total.
    if (result.matchedCount === 0) {
      delete set.totalRepaidRaw;
      await loans.updateOne({ loanId }, update, { arrayFilters: [{ "el.index": index }] });
    }
  }

  async markLiquidationCandidate(loanId: string): Promise<void> {
    const { loans } = await collections();
    await loans.updateOne(
      { loanId },
      { $set: { liquidationCandidate: true, updatedAt: new Date() } }
    );
  }

  async all(): Promise<BookLoan[]> {
    const { loans } = await collections();
    return (await loans.find({}).toArray()).map(toBookLoan);
  }
}

/** A receipt as the keeper produces it: dates as ISO strings. */
export type StoredReceipt = Omit<ReceiptDoc, "_id" | "createdAt" | "completedAt"> & {
  createdAt: string;
  completedAt?: string;
};

export class MongoReceiptStore {
  async put(receipt: Record<string, unknown>): Promise<void> {
    const { receipts } = await collections();
    // Upsert on (actionId, attempt): the keeper may write the same receipt
    // twice if a pass is interrupted after execution but before the write, and
    // a duplicate row would corrupt the reconciliation totals.
    await receipts.updateOne(
      { actionId: receipt.actionId as string, attempt: receipt.attempt as number },
      { $set: { ...receipt, createdAt: new Date(receipt.createdAt as string) } },
      { upsert: true }
    );
  }

  /**
   * Return receipts in the same shape the keeper writes them.
   *
   * Mongo stores `createdAt`/`completedAt` as Date; the keeper's Receipt type
   * carries ISO strings. Converting here rather than at the call site is what
   * lets MongoReceiptStore genuinely satisfy ReceiptStore -- previously this
   * returned `unknown[]` and the keeper papered over the gap with a cast,
   * which disabled type safety at exactly the boundary where a shape mismatch
   * would corrupt reconciliation.
   */
  async list(
    filter: { loanId?: string; kind?: string } = {}
  ): Promise<StoredReceipt[]> {
    const { receipts } = await collections();
    const query: Record<string, unknown> = {};
    if (filter.loanId) query.loanId = filter.loanId;
    if (filter.kind) query.kind = filter.kind;

    const docs = await receipts.find(query).sort({ createdAt: -1 }).limit(500).toArray();
    return docs.map(({ _id, createdAt, completedAt, ...rest }) => ({
      ...rest,
      createdAt: createdAt.toISOString(),
      completedAt: completedAt?.toISOString(),
    })) as StoredReceipt[];
  }
}

/** Append to the audit log. Never updated, never deleted. */
export async function recordEvent(event: {
  type: string;
  loanId?: string;
  merchantId?: string;
  borrower?: string;
  payload?: Record<string, unknown>;
  chainId: number;
  transactionHash?: string;
  blockNumber?: number;
}): Promise<void> {
  const { events } = await collections();
  await events.insertOne({
    ...event,
    payload: event.payload ?? {},
    createdAt: new Date(),
  });
}

/** Build the installment schedule for a new plan. */
/**
 * How much must be repaid for `k` of `count` instalments to count as earned.
 *
 * Mirrors `PolarisLoanEngine.thresholdFor` exactly, ceiling and all. The
 * contract is the authority on when an instalment is settled; anything here
 * that rounds differently produces a book that disagrees with the chain.
 */
function threshold(totalOwedRaw: bigint, k: number, count: number): bigint {
  if (k <= 0) return 0n;
  if (k >= count) return totalOwedRaw;
  const n = BigInt(count);
  return (totalOwedRaw * BigInt(k) + n - 1n) / n;
}

export function buildInstallments(params: {
  totalOwedRaw: bigint;
  count: number;
  intervalSeconds: number;
  startAt: Date;
  decimals?: number;
  symbol?: string;
}): InstallmentDoc[] {
  const decimals = params.decimals ?? 6;
  const symbol = params.symbol ?? "USDC";

  const out: InstallmentDoc[] = [];
  for (let i = 0; i < params.count; i++) {
    // Each instalment is the gap between two rungs of the contract's own
    // threshold ladder, so a charge lands exactly on a rung rather than a wei
    // under it.
    //
    // Dividing the total by the count and giving the remainder to the last
    // instalment also sums correctly, but it disagrees with the contract in the
    // middle: PolarisLoanEngine.thresholdFor rounds each rung *up*, so a
    // floored instalment falls short and installmentsPaid on chain lags the
    // book by one until the final payment lands. The reconciler duly reported
    // that as drift, because it is.
    const amount = threshold(params.totalOwedRaw, i + 1, params.count) -
      threshold(params.totalOwedRaw, i, params.count);
    out.push({
      index: i + 1,
      dueAt: new Date(params.startAt.getTime() + (i + 1) * params.intervalSeconds * 1000),
      amountRaw: amount.toString(),
      amountDisplay: `${formatUnits(amount, decimals)} ${symbol}`,
      state: "scheduled",
      attempts: 0,
    });
  }
  return out;
}

/**
 * Base units to a two-place decimal string.
 *
 * The sign is taken off the value and put back at the end, rather than being
 * left on the two halves to fight over. Previously `value % base` kept its own
 * minus sign, so `padStart` saw a string that was already long enough and
 * padded nothing, and `slice(0, 2)` then read the minus as a digit position:
 * -1500000 at 6 decimals rendered as "-1.-5", -500000 as "0.-5", and -1 as
 * "0.00" with the sign silently gone.
 *
 * Nothing can currently reach it with a negative -- the contract caps `repay`
 * at the remaining balance and `repaidAfterCollecting` caps at the room left --
 * but this is exported from the package's public API and takes any bigint, so
 * the invariant that saves it lives in three other files. One unclamped
 * subtraction away from a borrower reading "-1.-5" as their balance.
 */
export function formatUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, 2).padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
