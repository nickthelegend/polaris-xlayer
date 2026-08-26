/**
 * Receipts -- the disputable record of every credit action.
 *
 * A BNPL provider has to answer "was this customer charged, when, and can you
 * prove it?" long after the fact. KeeperHub already logs every direct execution
 * (trigger, simulation result, transaction hash, gas used, outcome, timestamp)
 * to its own audit trail; this is the PolarisPay-side projection of that,
 * joined to the loan and installment it belongs to so it can be shown to a
 * merchant, a customer, or an auditor without a KeeperHub login.
 */

import type { ExecutionStatusResponse } from "./types.js";

export type ReceiptKind =
  | "installment_charge"
  | "subscription_charge"
  | "liquidation"
  | "merchant_settlement"
  | "score_update";

export type ReceiptOutcome = "succeeded" | "failed" | "skipped";

export type Receipt = {
  /** Stable id of the business action, e.g. `loan-42-inst-3`. */
  actionId: string;
  kind: ReceiptKind;
  outcome: ReceiptOutcome;
  loanId?: string;
  installment?: number;
  subscriptionId?: string;
  merchantId?: string;
  /** Human-readable units. */
  amount?: string;
  chainId: number;
  /** Which attempt produced this receipt. */
  attempt: number;

  /** What the dry-run predicted before we spent anything. */
  simulation?: {
    ok: boolean;
    gasEstimate?: string;
    revertReason?: string;
  };

  /** What KeeperHub actually did. */
  execution?: {
    executionId: string;
    status: string;
    transactionHash?: string;
    transactionLink?: string;
    /** True when the Gas Station paid the fee. */
    sponsored?: boolean;
    gasUsedWei?: string;
  };

  error?: {
    kind: string;
    message: string;
  };

  createdAt: string;
  completedAt?: string;
};

export function receiptFromStatus(
  base: Omit<Receipt, "execution" | "createdAt" | "completedAt" | "outcome">,
  status: ExecutionStatusResponse
): Receipt {
  return {
    ...base,
    outcome: status.status === "completed" ? "succeeded" : "failed",
    execution: {
      executionId: status.executionId,
      status: status.status,
      transactionHash: status.transactionHash,
      transactionLink: status.transactionLink,
      sponsored: status.sponsored,
      gasUsedWei: status.gasUsedWei,
    },
    createdAt: status.createdAt ?? new Date().toISOString(),
    completedAt: status.completedAt,
  };
}

export interface ReceiptStore {
  put(receipt: Receipt): Promise<void>;
  list(filter?: { loanId?: string; kind?: ReceiptKind }): Promise<Receipt[]>;
}

/** Default store. Swap for Supabase/Convex in the apps -- both are already
 *  wired in polaris-core; this keeps the keeper runnable with zero infra. */
export class InMemoryReceiptStore implements ReceiptStore {
  private readonly rows: Receipt[] = [];

  async put(receipt: Receipt): Promise<void> {
    this.rows.push(receipt);
  }

  async list(filter: { loanId?: string; kind?: ReceiptKind } = {}): Promise<Receipt[]> {
    return this.rows.filter(
      (r) =>
        (filter.loanId === undefined || r.loanId === filter.loanId) &&
        (filter.kind === undefined || r.kind === filter.kind)
    );
  }
}

/** One-line summary for keeper logs and the demo reel. */
export function formatReceipt(r: Receipt): string {
  const head = `[${r.kind}] ${r.actionId} -> ${r.outcome}`;
  if (r.execution?.transactionHash) {
    const sponsored = r.execution.sponsored ? " (sponsored)" : "";
    return `${head}${sponsored} ${r.execution.transactionHash}`;
  }
  if (r.error) {
    return `${head} (${r.error.kind}: ${r.error.message})`;
  }
  return head;
}
