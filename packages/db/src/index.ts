export {
  closeDb,
  collections,
  ensureIndexes,
  getDb,
  mongoUri,
  ping,
} from "./client.js";

export {
  buildInstallments,
  formatUnits,
  MongoLoanBook,
  MongoReceiptStore,
  recordEvent,
  repaidAfterCollecting,
} from "./loanbook.js";
export type { BookLoan, StoredReceipt } from "./loanbook.js";

export { COLLECTIONS, INDEXES } from "./schema.js";
export type {
  EventDoc,
  InstallmentDoc,
  InstallmentState,
  LoanDoc,
  LoanStatus,
  MerchantDoc,
  MerchantStatus,
  ReceiptDoc,
  ReceiptKind,
  ReceiptOutcome,
} from "./schema.js";

export {
  generateApiKey,
  generateWebhookSecret,
  hashApiKey,
  merchantForApiKey,
  onboardMerchant,
  rotateApiKey,
  setMerchantStatus,
  settlementCsv,
} from './merchants.js';
export type { OnboardResult } from './merchants.js';

export {
  deliverWebhook,
  SIGNATURE_TOLERANCE_SECONDS,
  signPayload,
  verifySignature,
} from './webhooks.js';
export type { DeliveryResult, WebhookEvent, WebhookPayload } from './webhooks.js';

export { materialExposure, reconcile } from './reconcile.js';
export type { Drift, ReconcileReport } from './reconcile.js';

export { indexEvents, lastIndexedBlock } from './indexer.js';
export type { IndexResult } from './indexer.js';

export { markSettled, pendingSettlements } from './settlements.js';
export type { PendingSettlement } from './settlements.js';

export {
  STALE_AFTER_MINUTES,
  healthReport,
  recordHeartbeat,
  renderHealth,
} from './health.js';
export type { HealthReport, HealthStatus, Heartbeat, KeeperJob } from './health.js';
