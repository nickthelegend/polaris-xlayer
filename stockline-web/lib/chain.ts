import { ethers } from "ethers";
import path from "path";
import dotenv from "dotenv";

// The actor keys live in the workspace .env, one level up, so the same keys
// drive the scripts and this app rather than being duplicated.
if (typeof window === "undefined") {
  dotenv.config({ path: path.join(process.cwd(), "..", ".env") });
}
import deployment from "../../packages/contracts/deployments/stockline-xlayerTestnet.json";

/**
 * One place that knows where the contracts are and how to talk to them.
 *
 * Everything here is real: a real RPC, real deployed contracts on X Layer
 * testnet, real signed transactions. The shopper's key is a demo wallet
 * funded on testnet rather than a browser extension, because the point of
 * this surface is to show the credit rail working, not to re-implement wallet
 * connection. The transactions it signs are indistinguishable from any other.
 */
export const RPC = process.env.NEXT_PUBLIC_XLAYER_RPC || "https://testrpc.xlayer.tech";
export const CHAIN_ID = 1952;
export const EXPLORER = "https://www.oklink.com/x-layer-testnet";

export const ADDRESSES = deployment.contracts;
export const RISK = deployment.risk;
export const STAND_INS = deployment.standIns;

/*
 * ABIs come from the compiled artifacts, not from hand-written signature
 * lists. A hand-written list omits the custom error definitions, and without
 * those ethers cannot decode a revert: a healthy loan someone tried to
 * liquidate came back as "execution reverted (unknown custom error)" with a
 * 500, instead of the 409 explaining the position is fine. The artifact
 * carries every function and every error, so the reason always survives.
 */
import engineArtifact from "../../packages/contracts/artifacts/contracts/stockline/StocklineEngine.sol/StocklineEngine.json";
import oracleArtifact from "../../packages/contracts/artifacts/contracts/stockline/StockPriceOracle.sol/StockPriceOracle.json";
import poolArtifact from "../../packages/contracts/artifacts/contracts/stockline/LiquidityPool.sol/LiquidityPool.json";
import stockArtifact from "../../packages/contracts/artifacts/contracts/stockline/TestnetStock.sol/TestnetStock.json";
import stableArtifact from "../../packages/contracts/artifacts/contracts/MockUSDC.sol/MockUSDC.json";

export const ENGINE_ABI = engineArtifact.abi;
export const ORACLE_ABI = oracleArtifact.abi;
export const POOL_ABI = poolArtifact.abi;
/** The stand-in share token and the stand-in stablecoin share the ERC-20 surface. */
export const ERC20_ABI = [...stockArtifact.abi, ...stableArtifact.abi.filter(
  (f: any) => f.type === "function" && f.name === "mint"
)];

export function provider() {
  return new ethers.JsonRpcProvider(RPC, CHAIN_ID, {
    staticNetwork: true,
    // ethers batches JSON-RPC calls by default. X Layer's public endpoint
    // does not reliably return every response in a batch — under the load of
    // one page render it drops some, and ethers surfaces that as
    // "missing response for request", failing the whole page for a reason
    // that has nothing to do with the request. One call per request is
    // slower and correct.
    batchMaxCount: 1,
  });
}

/** Server-side signer for a role. Keys never reach the browser. */
export function signer(role: "deployer" | "shopper" | "merchant" | "liquidator") {
  const key =
    role === "deployer"
      ? process.env.DEPLOYER_PRIVATE_KEY
      : process.env[`ACTOR_${role.toUpperCase()}_KEY`];
  if (!key) throw new Error(`no key configured for ${role}`);
  return new ethers.Wallet(key, provider());
}

/**
 * A public RPC can serve state from before a transaction it has already
 * mined. Wait for the node to reach the receipt's block before reading back.
 */
export async function settle(receipt: ethers.TransactionReceipt | null) {
  if (!receipt) return;
  const p = provider();
  for (let i = 0; i < 40; i++) {
    if ((await p.getBlockNumber()) >= receipt.blockNumber) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export const fmtUsd = (v: bigint, decimals = 6) =>
  (Number(v) / 10 ** decimals).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtShares = (v: bigint) => (Number(v) / 1e18).toFixed(4);
export const STATUS = ["None", "Active", "Repaid", "Liquidated", "Refunded"];

/**
 * Turn a revert into something a person can read.
 *
 * ethers does not always populate `e.revert`: a custom error raised during
 * `estimateGas` arrives as CALL_EXCEPTION with `revert: null` and the message
 * "unknown custom error", even when the ABI defines it. Someone trying to
 * liquidate a healthy position got a 500 and that string instead of being
 * told the position was fine. So the raw return data is decoded here against
 * the interfaces we own, rather than trusting the error object to do it.
 */
const IFACES = [
  new ethers.Interface(ENGINE_ABI as any),
  new ethers.Interface(ORACLE_ABI as any),
  new ethers.Interface(POOL_ABI as any),
];

function revertData(e: any): string | null {
  const candidates = [e?.data, e?.info?.error?.data, e?.error?.data, e?.error?.error?.data];
  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("0x") && c.length >= 10) return c;
  }
  const m = String(e?.message ?? "").match(/data="?(0x[0-9a-fA-F]{8,})"?/);
  return m ? m[1] : null;
}

export type Revert = { name: string; args: string[] } | null;

export function decodeRevert(e: any): Revert {
  const data = revertData(e);
  if (!data) return null;
  for (const iface of IFACES) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return { name: parsed.name, args: parsed.args.map((a: any) => String(a)) };
    } catch { /* not this interface */ }
  }
  return null;
}

/** The message a user should see, given a decoded revert. */
export function explain(e: any, fallback: string): { message: string; status: number } {
  const r = decodeRevert(e);
  const by: Record<string, { message: string; status: number }> = {
    NotLiquidatable: { message: "That position is healthy — it cannot be liquidated.", status: 409 },
    NotActive: { message: "That loan is no longer active.", status: 409 },
    NotBorrower: { message: "Only the borrower can repay this loan.", status: 403 },
    NotMerchant: { message: "Only the merchant can refund this sale.", status: 403 },
    MarketShut: { message: "The venue is shut, so the collateral cannot be sold or seized.", status: 409 },
    ExceedsMaxLtv: { message: "That is more than the shares can support at the current LTV.", status: 400 },
    StalePrice: { message: "The market price is stale. The relayer needs to post a fresh print.", status: 409 },
    OrderAlreadyUsed: { message: "That order reference has already been used.", status: 409 },
    StockNotAccepted: { message: "That token is not accepted as collateral.", status: 400 },
    TenorOutOfRange: { message: "The tenor must be between 7 and 14 days.", status: 400 },
    InsufficientLiquidity: { message: "The pool does not have enough stablecoin to pay the merchant right now.", status: 409 },
    PriceWentBackwards: { message: "That print is older than the one already on chain, so it was refused.", status: 409 },
    MerchantNotRegistered: { message: "That merchant is not registered.", status: 403 },
    CollateralShortfall: { message: "The collateral that arrived did not match the amount requested.", status: 400 },
    NoPrice: { message: "There is no price on chain for that token yet.", status: 409 },
    ZeroAmount: { message: "That amount cannot be zero.", status: 400 },
  };
  if (r && by[r.name]) return by[r.name];
  if (r) return { message: `The contract rejected this: ${r.name}.`, status: 400 };
  return { message: e?.shortMessage || e?.message || fallback, status: 500 };
}
