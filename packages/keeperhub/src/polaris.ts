/**
 * Polaris protocol bindings.
 *
 * The minimal ABI surface the keeper needs, plus the three operations that
 * make up PolarisPay's on-chain lifecycle. Each maps a business event onto the
 * KeeperHub primitive that fits it:
 *
 *   installment due   -> simulate, then contract-call `repay`
 *   loan unhealthy    -> check-and-execute `checkLiquidatable` -> `liquidate`
 *   merchant payable  -> contract-call `settlePayment` (or a Tempo batch)
 *
 * Signatures are taken from packages/protocol/contracts/LoanEngine.sol and
 * apps/merchant/contracts/PolarisMerchantEscrow.sol.
 */

import { createHash } from "node:crypto";

import { chargeKey, encodeArgs, type KeeperHubClient } from "./client.js";
import { isKeeperHubError, KeeperHubError } from "./errors.js";
import {
  type Receipt,
  receiptFromStatus,
  type ReceiptStore,
} from "./receipts.js";
import type { ChainId } from "./types.js";

/** `LoanEngine` -- only what the keeper calls. */
export const LOAN_ENGINE_ABI = JSON.stringify([
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "checkLiquidatable",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "liquidate",
    stateMutability: "nonpayable",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "userActiveDebt",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "loans",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple" }],
  },
]);

/**
 * `BatchSettlement` -- the deployed contract that actually pays merchants.
 *
 * This replaces a `PolarisMerchantEscrow` ABI whose contract does not exist
 * anywhere in this repo. The keeper was calling `settlePayment` on the
 * merchant's own payout address, which is an EOA: under EVM rules a call to a
 * codeless address always succeeds and does nothing, so every settlement mined
 * with status 1, emitted zero logs, moved zero funds, and was recorded as a
 * success. Verified on chain -- payout balance identical either side of the
 * settlement block.
 */
export const BATCH_SETTLEMENT_ABI = JSON.stringify([
  {
    type: "function",
    name: "settleBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "batchId", type: "bytes32" },
      { name: "merchants", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "memos", type: "bytes32[]" },
    ],
    outputs: [{ name: "totalAmount", type: "uint256" }],
  },
]);

/** Kept as an alias so existing imports do not break. */
export const MERCHANT_ESCROW_ABI = BATCH_SETTLEMENT_ABI;

/** `PolarisPayments` -- the subscription entry points the keeper calls. */
export const PAYMENTS_ABI = JSON.stringify([
  {
    type: "function",
    name: "isChargeDue",
    stateMutability: "view",
    inputs: [{ name: "subId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "chargeDue",
    stateMutability: "nonpayable",
    inputs: [{ name: "subId", type: "uint256" }],
    outputs: [],
  },
]);

export type PolarisDeployment = {
  chainId: ChainId | number;
  loanEngine: string;
  scoreManager?: string;
  poolManager?: string;
  payments?: string;
  /** `BatchSettlement`, the contract merchants are actually paid from. */
  batchSettlement?: string;
};

export type CollectInstallmentParams = {
  loanId: string;
  /** 1-based installment index, for the receipt and the idempotency key. */
  installment: number;
  /** Base-unit amount (already scaled by the token's decimals). */
  amountRaw: string;
  /** Human-readable amount, for receipts only. */
  amountDisplay?: string;
  attempt?: number;
};

export type LiquidateParams = {
  loanId: string;
  attempt?: number;
};

export type ChargeSubscriptionParams = {
  subscriptionId: string;
  /** Human-readable amount, for receipts only. */
  amountDisplay?: string;
  attempt?: number;
};

export type SettleMerchantParams = {
  merchantId: string;
  /**
   * Where the money goes. Named `escrowAddress` before, which is what led to it
   * being used as a call target rather than a transfer recipient.
   */
  payoutAddress: string;
  amountRaw: string;
  orderId: string;
  details?: string;
  amountDisplay?: string;
  attempt?: number;
};

/**
 * A deterministic bytes32 from an arbitrary string, for batch ids and memos.
 *
 * sha256 rather than keccak256 because this package has no dependencies and
 * intends to keep it that way -- pulling in a 300kB crypto library to hash one
 * short string would be a poor trade. The contract treats the batch id as an
 * opaque key: it only ever compares it for equality against
 * `batchExecuted`, so any collision-resistant function works. Node ships
 * sha256; it does not ship keccak.
 */
function bytes32(value: string): string {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

export class PolarisKeeper {
  constructor(
    private readonly kh: KeeperHubClient,
    private readonly deployment: PolarisDeployment,
    private readonly receipts: ReceiptStore
  ) {}

  /**
   * Collect one installment.
   *
   * Simulate first. An installment that would revert -- almost always because
   * the borrower's balance moved -- becomes a dunning event rather than a
   * burnt transaction, and the reason is recorded on the receipt so the retry
   * ladder knows whether waiting will help.
   */
  async collectInstallment(params: CollectInstallmentParams): Promise<Receipt> {
    const attempt = params.attempt ?? 1;
    const actionId = `loan-${params.loanId}-inst-${params.installment}`;
    const call = {
      contractAddress: this.deployment.loanEngine,
      chainId: this.deployment.chainId,
      functionName: "repay",
      functionArgs: encodeArgs([params.loanId, params.amountRaw]),
      abi: LOAN_ENGINE_ABI,
    };

    const base = {
      actionId,
      kind: "installment_charge" as const,
      loanId: params.loanId,
      installment: params.installment,
      amount: params.amountDisplay ?? params.amountRaw,
      chainId: Number(this.deployment.chainId),
      attempt,
    };

    try {
      const sim = await this.kh.assertWouldSucceed(call);
      const status = await this.kh.executeAndConfirm(call, {
        idempotencyKey: chargeKey(actionId, attempt),
      });
      const receipt = receiptFromStatus(
        {
          ...base,
          simulation: { ok: true, gasEstimate: sim?.gasEstimate },
        },
        status
      );
      await this.receipts.put(receipt);
      return receipt;
    } catch (err) {
      const receipt = failureReceipt(base, err);
      await this.receipts.put(receipt);
      return receipt;
    }
  }

  /**
   * Liquidate a loan, but only if the protocol says it is liquidatable.
   *
   * The read and the write happen inside a single KeeperHub call, so there is
   * no window between "is it liquidatable?" and "liquidate it" for another
   * keeper -- or a last-second repayment -- to invalidate the decision. A
   * condition that does not hold costs nothing and sends nothing.
   */
  async liquidateIfUnhealthy(params: LiquidateParams): Promise<Receipt> {
    const attempt = params.attempt ?? 1;
    const actionId = `loan-${params.loanId}-liquidate`;
    const base = {
      actionId,
      kind: "liquidation" as const,
      loanId: params.loanId,
      chainId: Number(this.deployment.chainId),
      attempt,
    };

    try {
      const result = await this.kh.checkAndExecute(
        {
          contractAddress: this.deployment.loanEngine,
          chainId: this.deployment.chainId,
          functionName: "checkLiquidatable",
          functionArgs: encodeArgs([params.loanId]),
          abi: LOAN_ENGINE_ABI,
          condition: { operator: "eq", value: "true" },
          action: {
            contractAddress: this.deployment.loanEngine,
            functionName: "liquidate",
            functionArgs: encodeArgs([params.loanId]),
            abi: LOAN_ENGINE_ABI,
          },
        },
        { idempotencyKey: chargeKey(actionId, attempt) }
      );

      if (!("executionId" in result)) {
        // Healthy loan. This is the overwhelmingly common path and is a
        // success, not a failure -- record it so the run log shows coverage.
        const receipt: Receipt = {
          ...base,
          outcome: "skipped",
          createdAt: new Date().toISOString(),
        };
        await this.receipts.put(receipt);
        return receipt;
      }

      const status = await this.kh.waitForTerminal(result.executionId);
      const receipt = receiptFromStatus(base, status);
      await this.receipts.put(receipt);
      return receipt;
    } catch (err) {
      const receipt = failureReceipt(base, err);
      await this.receipts.put(receipt);
      return receipt;
    }
  }

  /**
   * Collect one subscription period.
   *
   * Check-and-execute rather than simulate-then-send, because `chargeDue`
   * reverts with NotDue right up until the period boundary and the boundary
   * moves under us: another keeper -- the entry point is permissionless -- or
   * the subscriber cancelling between our read and our write. Asking the chain
   * `isChargeDue` and acting on the answer inside one call closes that window,
   * and a subscription that is not due costs nothing and sends nothing.
   */
  async chargeSubscription(params: ChargeSubscriptionParams): Promise<Receipt> {
    const attempt = params.attempt ?? 1;
    const actionId = `subscription-${params.subscriptionId}-charge`;
    const payments = this.deployment.payments;

    const base = {
      actionId,
      kind: "subscription_charge" as const,
      subscriptionId: params.subscriptionId,
      amount: params.amountDisplay,
      chainId: Number(this.deployment.chainId),
      attempt,
    };

    if (!payments) {
      return failureReceipt(
        base,
        new Error(
          "PolarisPayments address is not configured; set POLARIS_PAYMENTS to charge subscriptions."
        )
      );
    }

    try {
      const result = await this.kh.checkAndExecute(
        {
          contractAddress: payments,
          chainId: this.deployment.chainId,
          functionName: "isChargeDue",
          functionArgs: encodeArgs([params.subscriptionId]),
          abi: PAYMENTS_ABI,
          condition: { operator: "eq", value: "true" },
          action: {
            contractAddress: payments,
            functionName: "chargeDue",
            functionArgs: encodeArgs([params.subscriptionId]),
            abi: PAYMENTS_ABI,
          },
        },
        { idempotencyKey: chargeKey(actionId, attempt) }
      );

      if (!("executionId" in result)) {
        // Not due yet. The common path on any pass, and a success -- recorded
        // so the run log shows the subscription was covered, not missed.
        const receipt: Receipt = {
          ...base,
          outcome: "skipped",
          createdAt: new Date().toISOString(),
        };
        await this.receipts.put(receipt);
        return receipt;
      }

      const status = await this.kh.waitForTerminal(result.executionId);
      const receipt = receiptFromStatus(base, status);
      await this.receipts.put(receipt);
      return receipt;
    } catch (err) {
      const receipt = failureReceipt(base, err);
      await this.receipts.put(receipt);
      return receipt;
    }
  }

  /**
   * Pay a merchant, through the deployed BatchSettlement contract.
   *
   * The previous implementation called `settlePayment` on the merchant's own
   * payout address. That address is an EOA, and a call to a codeless address
   * cannot revert -- so every settlement mined successfully, emitted no logs,
   * transferred nothing, and was recorded as paid. The merchant's balance was
   * byte-identical either side of the settlement block.
   *
   * `settleBatch` is a real contract call against a real balance, and it fails
   * loudly when it cannot pay. It also carries its own on-chain idempotency via
   * `batchExecuted[batchId]`, which is why the batch id is a hash of the payout
   * itself: the same merchants for the same amounts can never pay twice, no
   * matter how many times the keeper is run.
   */
  async settleMerchant(params: SettleMerchantParams): Promise<Receipt> {
    const attempt = params.attempt ?? 1;
    const settlement = this.deployment.batchSettlement;
    const settlementTarget = settlement ?? "unconfigured";
    const base = {
      /*
       * The action is (who, what orders, how much, through which rail).
       *
       * Dropping the rail from the key meant that repointing settlement from
       * the old phantom escrow onto BatchSettlement re-sent an identical key
       * with a completely different payload, and KeeperHub refused it -- which
       * is exactly what it should do. A payout through a different contract is
       * a different action and deserves a different key.
       */
      actionId: `merchant-${params.merchantId}-order-${params.orderId}-amt-${params.amountRaw}-via-${settlementTarget}`,
      kind: "merchant_settlement" as const,
      merchantId: params.merchantId,
      amount: params.amountDisplay ?? params.amountRaw,
      chainId: Number(this.deployment.chainId),
      attempt,
    };

    if (!settlement) {
      const receipt: Receipt = {
        ...base,
        outcome: "failed",
        error: {
          kind: "validation",
          message:
            "No settlement contract configured. Set POLARIS_BATCH_SETTLEMENT -- without it there is nowhere to pay a merchant from.",
        },
        createdAt: new Date().toISOString(),
      };
      await this.receipts.put(receipt);
      return receipt;
    }

    /*
     * The batch id is derived from what is being paid, not from when. Two runs
     * that would pay the same merchant the same amount collapse onto one batch
     * the contract has already executed; a genuinely larger payout is a
     * different batch. This is the same rule the idempotency key follows, moved
     * on chain where it cannot be bypassed by rotating a header.
     */
    const batchId = bytes32(
      `${params.merchantId}|${params.payoutAddress}|${params.amountRaw}|${params.orderId}`
    );
    const memo = bytes32(params.orderId);

    const call = {
      contractAddress: settlement,
      chainId: this.deployment.chainId,
      functionName: "settleBatch",
      functionArgs: encodeArgs([
        batchId,
        [params.payoutAddress],
        [params.amountRaw],
        [memo],
      ]),
      abi: BATCH_SETTLEMENT_ABI,
    };

    try {
      const sim = await this.kh.assertWouldSucceed(call);
      const status = await this.kh.executeAndConfirm(call, {
        idempotencyKey: chargeKey(base.actionId, attempt),
      });
      const receipt = receiptFromStatus(
        { ...base, simulation: { ok: true, gasEstimate: sim?.gasEstimate } },
        status
      );
      await this.receipts.put(receipt);
      return receipt;
    } catch (err) {
      const receipt = failureReceipt(base, err);
      await this.receipts.put(receipt);
      return receipt;
    }
  }
}

function failureReceipt(
  base: Omit<Receipt, "outcome" | "createdAt">,
  err: unknown
): Receipt {
  const khErr = isKeeperHubError(err)
    ? err
    : new KeeperHubError("unknown", (err as Error)?.message ?? String(err));
  return {
    ...base,
    outcome: "failed",
    simulation:
      khErr.kind === "would_revert" || khErr.kind === "insufficient_funds"
        ? { ok: false, revertReason: khErr.details ?? khErr.message }
        : base.simulation,
    error: { kind: khErr.kind, message: khErr.message },
    createdAt: new Date().toISOString(),
  };
}
