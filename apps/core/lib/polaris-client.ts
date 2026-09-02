"use client";

import { ethers } from "ethers";
import abis from "./polaris-abis.json";
import deployment from "./polaris-deployment.json";
import { ACTIVE_CHAIN } from "./chains";

/**
 * The browser's view of Polaris.
 *
 * Addresses and ABIs only — no keys, no provider, no signing. Every write goes
 * through wagmi so the connected wallet is the one that signs. Reads that need
 * no wallet still go to the server route, which holds the RPC quota.
 */
export const ADDRESSES = deployment.contracts;
export const RISK = deployment.risk;
export const STAND_INS = deployment.standIns;
export const EXPLORER = ACTIVE_CHAIN.blockExplorers.default.url;

export const ENGINE_ABI = abis.PolarisEngine;
export const ORACLE_ABI = abis.StockPriceOracle;
export const POOL_ABI = abis.LiquidityPool;
export const ERC20_ABI = abis.TestnetStock;

const IFACES = [
  new ethers.Interface(ENGINE_ABI as any),
  new ethers.Interface(ORACLE_ABI as any),
  new ethers.Interface(POOL_ABI as any),
  new ethers.Interface(ERC20_ABI as any),
];

/**
 * What a revert actually said.
 *
 * viem surfaces a custom error from a failed simulation without decoding it
 * against our ABI, so the raw 4-byte selector is all that survives. Decoding
 * it here is what turns "execution reverted" into a sentence the person who
 * pressed the button can act on. Same table as the server used, so both sides
 * say the same thing.
 */
const MESSAGES: Record<string, string> = {
  NotLiquidatable: "That position is healthy — it cannot be liquidated.",
  NotActive: "That loan is no longer active.",
  NotBorrower: "Only the borrower can repay this loan.",
  NotMerchant: "Only the merchant can refund this sale.",
  MarketShut: "The venue is shut, so the collateral cannot be sold or seized.",
  ExceedsMaxLtv: "That is more than the shares can support at the current LTV.",
  StalePrice: "The market price is stale. The relayer needs to post a fresh print.",
  OrderAlreadyUsed: "You have already paid this order reference.",
  StockNotAccepted: "That token is not accepted as collateral.",
  TenorOutOfRange: "The tenor must be between 7 and 14 days.",
  InsufficientLiquidity: "The pool does not have enough stablecoin to pay the merchant right now.",
  PriceWentBackwards: "That print is older than the one already on chain, so it was refused.",
  MerchantNotRegistered: "That merchant is not registered.",
  CollateralShortfall: "The collateral that arrived did not match the amount requested.",
  NoPrice: "There is no price on chain for that token yet.",
  ZeroAmount: "That amount cannot be zero.",
  FaucetExhausted: "You have already drawn the maximum from the faucet.",
  ERC20InsufficientBalance: "You do not hold enough of that token.",
  ERC20InsufficientAllowance: "The engine is not approved to move your shares yet.",
};

function findData(e: any): string | null {
  const seen = new Set<any>();
  const walk = (o: any, depth = 0): string | null => {
    if (!o || depth > 6 || seen.has(o)) return null;
    seen.add(o);
    if (typeof o === "string" && /^0x[0-9a-fA-F]{8,}$/.test(o)) return o;
    if (typeof o !== "object") return null;
    for (const k of ["data", "cause", "error", "info", "details", "walk"]) {
      const hit = walk((o as any)[k], depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  const direct = walk(e);
  if (direct) return direct;
  const m = String(e?.message ?? "").match(/(0x[0-9a-fA-F]{8,})/);
  return m ? m[1] : null;
}

/** A sentence for a failed write, or the raw reason if we genuinely cannot name it. */
export function explainWriteError(e: any): string {
  const name = String(e?.name ?? "");
  const msg = String(e?.shortMessage ?? e?.message ?? "");
  // A user closing the wallet popup is not an error worth a red panel.
  if (/User rejected|denied transaction|ACTION_REJECTED|UserRejected/i.test(name + msg)) {
    return "You cancelled the transaction.";
  }
  const data = findData(e);
  if (data) {
    for (const iface of IFACES) {
      try {
        const parsed = iface.parseError(data);
        if (parsed && MESSAGES[parsed.name]) return MESSAGES[parsed.name];
        if (parsed) return `The contract rejected this: ${parsed.name}.`;
      } catch {
        /* not this interface */
      }
    }
  }
  if (/insufficient funds/i.test(msg)) return "Not enough OKB to pay for gas on X Layer.";
  return msg || "The transaction failed.";
}

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
