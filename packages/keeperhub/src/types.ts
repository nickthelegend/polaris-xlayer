/**
 * Wire types for the KeeperHub direct-execution API.
 *
 * These mirror `POST /api/execute/*` and `GET /api/execute/{id}/status` as
 * documented at https://docs.keeperhub.com. They are intentionally written as
 * the *response* shapes we actually depend on rather than an exhaustive model:
 * anything we do not read stays untyped so a server-side addition never breaks
 * a build here.
 */

/** Chains PolarisPay settles on. Spoke vaults live on the testnets; Base and
 *  Ethereum mainnet are where sponsored production charges run. */
export const CHAIN = {
  ethereum: 1,
  base: 8453,
  polygon: 137,
  arbitrum: 42_161,
  sepolia: 11_155_111,
  baseSepolia: 84_532,
  polygonAmoy: 80_002,
  arbitrumSepolia: 421_614,
} as const;

export type ChainId = (typeof CHAIN)[keyof typeof CHAIN];

/**
 * Chains where KeeperHub's Turnkey Gas Station can sponsor the fee, so a
 * PolarisPay keeper wallet never needs a native balance.
 *
 * Mirrors `SPONSORSHIP_CHAINS` in the KeeperHub source. Sponsorship is also
 * conditional at runtime on the org having gas credits, using a direct wallet
 * sender (not a Safe) and *not* routing through a private mempool -- see
 * https://docs.keeperhub.com/wallet-management/gas. We treat this list as
 * "eligible", never as "guaranteed".
 */
export const SPONSORSHIP_ELIGIBLE_CHAINS: readonly number[] = [
  CHAIN.ethereum,
  CHAIN.polygon,
  CHAIN.base,
  CHAIN.arbitrum,
  CHAIN.sepolia,
  CHAIN.polygonAmoy,
  CHAIN.baseSepolia,
  CHAIN.arbitrumSepolia,
];

/** Terminal + in-flight execution states returned by the status route. */
export type ExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export const TERMINAL_STATUSES: readonly ExecutionStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** 202 body from `POST /api/execute/*` for a write. */
export type ExecuteAccepted = {
  executionId: string;
  status: string;
};

/**
 * `GET /api/execute/{executionId}/status`.
 *
 * Note the segment order: `/api/execute/{id}/status`, not
 * `/api/execute/status/{id}` (the latter 405s). The execute response itself
 * carries no transaction hash, so this route is the only way to learn one --
 * and for a gas-sponsored execution it is the *only* signal at all, because a
 * sponsored send runs through a smart account and never moves the keeper EOA's
 * nonce, balance or explorer tx list. See KeeperHub issue #1784.
 */
export type ExecutionStatusResponse = {
  executionId: string;
  type?: string;
  status: ExecutionStatus | string;
  result?: unknown;
  error?: string;
  transactionHash?: string;
  transactionLink?: string;
  sponsored?: boolean;
  gasUsedWei?: string;
  createdAt?: string;
  completedAt?: string;
};

/** 200 body when a simulate/dry-run or a read call short-circuits. */
export type SimulationResult = {
  simulated?: boolean;
  success?: boolean;
  gasEstimate?: string;
  gasUsed?: string;
  result?: unknown;
  /** Decoded revert reason when the call would fail. */
  revertReason?: string;
  error?: string;
};

/** `POST /api/execute/check-and-execute` when the condition was not met. */
export type ConditionNotMet = {
  executed: false;
  conditionResult: unknown;
};

export type ComparisonOperator = "eq" | "neq" | "gt" | "lt" | "gte" | "lte";

export type ContractCallInput = {
  contractAddress: string;
  chainId: ChainId | number;
  functionName: string;
  /** JSON-encoded argument array, e.g. `'["0x…","1000"]'`. */
  functionArgs?: string;
  /** ABI as a JSON string. Omit for verified contracts and KeeperHub fetches it. */
  abi?: string;
  /** Native value in ether units, for payable functions. */
  value?: string;
  gasLimitMultiplier?: string;
  priorityFeeGwei?: string;
};

export type TransferInput = {
  chainId: ChainId | number;
  recipientAddress: string;
  /** Human-readable units, e.g. "0.1". */
  amount: string;
  /** Omit for a native transfer. */
  tokenAddress?: string;
};

export type CheckAndExecuteInput = {
  /** Contract holding the value to test. */
  contractAddress: string;
  chainId: ChainId | number;
  functionName: string;
  functionArgs?: string;
  abi?: string;
  condition: {
    operator: ComparisonOperator;
    value: string;
  };
  action: {
    contractAddress: string;
    functionName: string;
    functionArgs?: string;
    abi?: string;
    gasLimitMultiplier?: string;
  };
};

/** Structured error surfaced by the execute routes. */
export type ExecuteErrorBody = {
  error: string;
  field?: string;
  details?: string;
};
