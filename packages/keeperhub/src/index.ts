/**
 * @polarispay/keeperhub
 *
 * The execution layer for PolarisPay credit. Everything that has to touch a
 * chain -- collecting an installment, liquidating a defaulted loan, paying a
 * merchant -- goes through KeeperHub so that it simulates first, never
 * double-charges, always reconciles to a terminal status, and leaves a receipt.
 */

export { chargeKey, encodeArgs, KeeperHubClient } from "./client.js";
export type { KeeperHubClientOptions, KeeperHubEvent } from "./client.js";

export {
  classifyFailure,
  errorFromResponse,
  isIndefinite,
  isKeeperHubError,
  KeeperHubError,
} from "./errors.js";
export type { KeeperHubErrorKind } from "./errors.js";

export {
  DEFAULT_DUNNING_LADDER,
  dunningMessage,
  nextDunningStep,
  partialCollection,
  selfCure,
} from "./dunning.js";
export type {
  DunningDecision,
  DunningInput,
  DunningStage,
  PartialDecision,
} from "./dunning.js";

export {
  LOAN_ENGINE_ABI,
  MERCHANT_ESCROW_ABI,
  PolarisKeeper,
} from "./polaris.js";
export type {
  CollectInstallmentParams,
  LiquidateParams,
  PolarisDeployment,
  SettleMerchantParams,
} from "./polaris.js";

export {
  formatReceipt,
  InMemoryReceiptStore,
  receiptFromStatus,
} from "./receipts.js";
export type { Receipt, ReceiptKind, ReceiptOutcome, ReceiptStore } from "./receipts.js";

export {
  CHAIN,
  isTerminal,
  SPONSORSHIP_ELIGIBLE_CHAINS,
  TERMINAL_STATUSES,
} from "./types.js";
export type {
  ChainId,
  CheckAndExecuteInput,
  ComparisonOperator,
  ConditionNotMet,
  ContractCallInput,
  ExecuteAccepted,
  ExecuteErrorBody,
  ExecutionStatus,
  ExecutionStatusResponse,
  SimulationResult,
  TransferInput,
} from "./types.js";
