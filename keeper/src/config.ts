/** Keeper configuration, read from the environment. */

import { CHAIN, SPONSORSHIP_ELIGIBLE_CHAINS } from "@polarispay/keeperhub";

export type KeeperConfig = {
  apiKey: string;
  baseUrl: string;
  chainId: number;
  loanEngine: string;
  /** Escrow used when settling merchants, if the run includes settlement. */
  /** `BatchSettlement`, the contract merchants are actually paid from. */
  batchSettlement?: string;
  /** PolarisPayments, for subscription charges. */
  payments?: string;
  /** Node the keeper reads chain state from directly, e.g. to list subscriptions. */
  rpcUrl: string;
  /** Print what would happen without sending anything. */
  dryRun: boolean;
  /** Seconds between passes in `run`. */
  intervalSeconds: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const apiKey = env.KEEPERHUB_API_KEY ?? "";
  if (!apiKey) {
    throw new Error(
      "KEEPERHUB_API_KEY is not set. Create an organization API key in the KeeperHub dashboard (it starts with `kh_`) and export it, or copy keeper/.env.example to .env."
    );
  }

  const chainId = Number(env.POLARIS_CHAIN_ID ?? CHAIN.sepolia);
  const loanEngine = env.POLARIS_LOAN_ENGINE ?? "";
  if (!loanEngine) {
    throw new Error(
      "POLARIS_LOAN_ENGINE is not set. Point it at the LoanEngine address for this chain (see packages/protocol/deployments.json)."
    );
  }

  return {
    apiKey,
    baseUrl: env.KEEPERHUB_BASE_URL ?? "https://app.keeperhub.com",
    chainId,
    loanEngine,
    batchSettlement: env.POLARIS_BATCH_SETTLEMENT,
    payments: env.POLARIS_PAYMENTS,
    rpcUrl: env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    dryRun: env.KEEPER_DRY_RUN === "true",
    intervalSeconds: Number(env.KEEPER_INTERVAL_SECONDS ?? 300),
  };
}

/** Warn early when a chain cannot be gas-sponsored, rather than at the first
 *  charge that fails for want of a native balance. */
export function sponsorshipNote(chainId: number): string {
  return SPONSORSHIP_ELIGIBLE_CHAINS.includes(chainId)
    ? `chain ${chainId} is sponsorship-eligible (subject to gas credits, a direct wallet sender, and not routing through a private mempool)`
    : `chain ${chainId} is NOT sponsorship-eligible -- the keeper wallet must hold a native balance to pay gas`;
}
