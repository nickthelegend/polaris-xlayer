export {
  BASELINE_SCORE,
  MAX_STARTING_SCORE,
  MIN_SCORE,
  SIGNAL_CAPS,
  aaveHistorySignal,
  defiTenureSignal,
  explain,
  fundingConcentrationSignal,
  liquidationHistorySignal,
  scoreFromSignals,
  stablecoinBalanceSignal,
  transactionCountSignal,
  walletAgeSignal,
} from "./signals.js";
export type { Signal, SignalName, UnderwritingResult } from "./signals.js";

export { collectSignals } from "./collect.js";
export type { CollectorConfig } from "./collect.js";
