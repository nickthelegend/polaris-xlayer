import type { ObjectId } from "mongodb";

/**
 * PolarisPay collections.
 *
 * Money amounts are stored as base-unit *strings*, never as numbers. A USDC
 * amount in base units exceeds Number.MAX_SAFE_INTEGER well before it reaches
 * an interesting balance, and BSON doubles silently lose precision -- so the
 * canonical value is always the string and any number nearby is display-only.
 */

export type InstallmentState = "scheduled" | "paid" | "dunning" | "written_off";
export type LoanStatus = "active" | "repaid" | "liquidated" | "defaulted";
export type MerchantStatus = "pending" | "active" | "suspended";

/** Mirrors the keeper's Receipt discriminants so the two stay in step. */
export type ReceiptKind =
  | "installment_charge"
  | "subscription_charge"
  | "liquidation"
  | "merchant_settlement"
  | "score_update";
export type ReceiptOutcome = "succeeded" | "failed" | "skipped";

export type MerchantDoc = {
  _id?: ObjectId;
  merchantId: string;
  name: string;
  walletAddress: string;
  payoutAddress: string;
  apiKeyHash: string;
  webhookUrl?: string;
  webhookSecret?: string;
  status: MerchantStatus;
  /** Base units. */
  maxOrderValue: string;
  totalSettled: string;
  chainId: number;
  createdAt: Date;
  updatedAt: Date;
};

export type InstallmentDoc = {
  index: number;
  dueAt: Date;
  amountRaw: string;
  amountDisplay: string;
  state: InstallmentState;
  attempts: number;
  nextAttemptAt?: Date;
  lastFailureKind?: string;
  paidAt?: Date;
  transactionHash?: string;
  /** Set once this instalment has been paid out to the merchant. */
  settledAt?: Date;
};

export type LoanDoc = {
  _id?: ObjectId;
  /** On-chain loan id from PolarisLoanEngine. */
  loanId: string;
  chainId: number;
  borrower: string;
  merchantId: string;
  orderId: string;
  principalRaw: string;
  totalOwedRaw: string;
  totalRepaidRaw: string;
  status: LoanStatus;
  installments: InstallmentDoc[];
  liquidationCandidate: boolean;
  creditScoreAtOrigination?: number;
  /** Set when the loan leaves `active`, whether by repayment or liquidation. */
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type ReceiptDoc = {
  _id?: ObjectId;
  actionId: string;
  kind: ReceiptKind;
  outcome: ReceiptOutcome;
  loanId?: string;
  installment?: number;
  subscriptionId?: string;
  merchantId?: string;
  amount?: string;
  chainId: number;
  attempt: number;
  simulation?: { ok: boolean; gasEstimate?: string; revertReason?: string };
  execution?: {
    executionId: string;
    status: string;
    transactionHash?: string;
    transactionLink?: string;
    sponsored?: boolean;
    gasUsedWei?: string;
  };
  error?: { kind: string; message: string };
  createdAt: Date;
  completedAt?: Date;
};

/** Append-only audit log. Nothing here is ever updated or deleted. */
export type EventDoc = {
  _id?: ObjectId;
  type: string;
  loanId?: string;
  merchantId?: string;
  borrower?: string;
  payload: Record<string, unknown>;
  chainId: number;
  blockNumber?: number;
  transactionHash?: string;
  createdAt: Date;
};

export const COLLECTIONS = {
  merchants: "merchants",
  loans: "loans",
  receipts: "receipts",
  events: "events",
} as const;

/**
 * Indexes, declared as data so `migrate` stays a loop rather than a script
 * that drifts from what the queries actually need.
 */
export const INDEXES: Array<{
  collection: string;
  spec: Record<string, 1 | -1>;
  options?: { unique?: boolean; name?: string };
}> = [
  { collection: "merchants", spec: { merchantId: 1 }, options: { unique: true } },
  { collection: "merchants", spec: { apiKeyHash: 1 }, options: { unique: true } },
  { collection: "merchants", spec: { walletAddress: 1 } },

  { collection: "loans", spec: { loanId: 1, chainId: 1 }, options: { unique: true } },
  { collection: "loans", spec: { borrower: 1 } },
  { collection: "loans", spec: { merchantId: 1 } },
  // The keeper's hot query: which installments are collectable right now.
  { collection: "loans", spec: { status: 1, "installments.state": 1, "installments.dueAt": 1 } },
  { collection: "loans", spec: { liquidationCandidate: 1, status: 1 } },

  { collection: "receipts", spec: { actionId: 1, attempt: 1 }, options: { unique: true } },
  { collection: "receipts", spec: { loanId: 1 } },
  { collection: "receipts", spec: { createdAt: -1 } },

  { collection: "events", spec: { type: 1, createdAt: -1 } },
  { collection: "events", spec: { loanId: 1 } },
  { collection: "events", spec: { transactionHash: 1 } },
];
