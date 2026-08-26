/**
 * Gather underwriting signals from live chain.
 *
 * Each source is independent and failure-isolated: an unreachable RPC or a
 * rate-limited explorer contributes a zero-point signal rather than failing the
 * assessment. A borrower must never be declined because our data source blinked.
 */

import {
  aaveHistorySignal,
  defiTenureSignal,
  fundingConcentrationSignal,
  liquidationHistorySignal,
  scoreFromSignals,
  stablecoinBalanceSignal,
  transactionCountSignal,
  walletAgeSignal,
  type Signal,
  type UnderwritingResult,
} from "./signals.js";

export type CollectorConfig = {
  rpcUrl: string;
  chainId: number;
  /** Stablecoin whose balance counts toward the assessment. */
  stablecoin?: string;
  /** Blockscout-compatible API, used for wallet age and counters. */
  explorerApi?: string;
  /** Aave V3 Pool, for the repayment-history signal. */
  aavePool?: string;
  /** Contracts whose touch counts as DeFi tenure. */
  knownProtocols?: string[];
};

type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

function makeRpc(url: string): Rpc {
  return async (method, params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(9000),
    });
    const json = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result;
  };
}

/** Run a source, and degrade to a zero-point signal if it fails. */
async function safely(
  name: Signal["name"],
  fn: () => Promise<Signal>
): Promise<Signal> {
  try {
    return await fn();
  } catch (err) {
    return {
      name,
      points: 0,
      evidence: `Could not read this signal (${(err as Error).message.slice(0, 80)}).`,
    };
  }
}

export async function collectSignals(
  address: string,
  config: CollectorConfig
): Promise<UnderwritingResult> {
  const rpc = makeRpc(config.rpcUrl);
  const addr = address.toLowerCase();

  const signals = await Promise.all([
    safely("transaction_count", async () => {
      const hex = (await rpc("eth_getTransactionCount", [addr, "latest"])) as string;
      return transactionCountSignal(Number(BigInt(hex)));
    }),

    safely("wallet_age", async () => {
      if (!config.explorerApi) {
        // Without an explorer there is no cheap way to find the first
        // transaction, and scanning the chain for it is not worth the latency
        // at checkout. Nonce is a weak proxy and is already its own signal.
        return walletAgeSignal(null);
      }
      const res = await fetch(
        `${config.explorerApi}?module=account&action=txlist&address=${addr}&sort=asc&page=1&offset=1`,
        { signal: AbortSignal.timeout(9000) }
      );
      const json = (await res.json()) as { result?: Array<{ timeStamp?: string }> };
      const first = json.result?.[0]?.timeStamp;
      if (!first) return walletAgeSignal(null);
      return walletAgeSignal(Date.now() - Number(first) * 1000);
    }),

    safely("stablecoin_balance", async () => {
      if (!config.stablecoin) return stablecoinBalanceSignal(0n);
      // balanceOf(address)
      const data = `0x70a08231${addr.replace("0x", "").padStart(64, "0")}`;
      const hex = (await rpc("eth_call", [
        { to: config.stablecoin, data },
        "latest",
      ])) as string;
      return stablecoinBalanceSignal(hex && hex !== "0x" ? BigInt(hex) : 0n);
    }),

    safely("defi_tenure", async () => {
      const protocols = config.knownProtocols ?? [];
      if (protocols.length === 0) return defiTenureSignal(0);

      // A non-zero allowance to a protocol is the cheapest reliable proof of
      // having transacted with it, and it is one call per protocol rather than
      // a log scan.
      let touched = 0;
      for (const p of protocols) {
        if (!config.stablecoin) break;
        const data =
          `0xdd62ed3e${addr.replace("0x", "").padStart(64, "0")}` +
          `${p.replace("0x", "").padStart(64, "0")}`;
        try {
          const hex = (await rpc("eth_call", [
            { to: config.stablecoin, data },
            "latest",
          ])) as string;
          if (hex && hex !== "0x" && BigInt(hex) > 0n) touched++;
        } catch {
          // one protocol failing must not sink the signal
        }
      }
      return defiTenureSignal(touched);
    }),

    safely("aave_history", async () => {
      if (!config.aavePool) {
        return aaveHistorySignal({ hasBorrowed: false, healthFactor: null, monthsActive: 0 });
      }
      // getUserAccountData(address) -> (…, totalDebtBase at slot 1, …, healthFactor at slot 5)
      const data = `0xbf92857c${addr.replace("0x", "").padStart(64, "0")}`;
      const hex = (await rpc("eth_call", [{ to: config.aavePool, data }, "latest"])) as string;
      if (!hex || hex === "0x" || hex.length < 2 + 64 * 6) {
        return aaveHistorySignal({ hasBorrowed: false, healthFactor: null, monthsActive: 0 });
      }
      const slot = (i: number) => BigInt(`0x${hex.slice(2 + i * 64, 2 + (i + 1) * 64)}`);
      const totalDebt = slot(1);
      const hfRaw = slot(5);

      // Aave returns type(uint256).max as the health factor when there is no
      // debt, which would otherwise read as an impossibly healthy position.
      const healthFactor =
        totalDebt > 0n && hfRaw < 2n ** 200n ? Number(hfRaw) / 1e18 : null;

      return aaveHistorySignal({
        hasBorrowed: totalDebt > 0n,
        healthFactor,
        // Duration needs an indexer; absent one, credit the position itself
        // rather than inventing a tenure.
        monthsActive: totalDebt > 0n ? 1 : 0,
      });
    }),

    safely("liquidation_history", async () => {
      if (!config.aavePool) return liquidationHistorySignal(0);
      // LiquidationCall(address,address,address,uint256,uint256,address,bool)
      const topic = "0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286";
      const userTopic = `0x${addr.replace("0x", "").padStart(64, "0")}`;
      const logs = (await rpc("eth_getLogs", [
        {
          address: config.aavePool,
          topics: [topic, null, null, userTopic],
          fromBlock: "earliest",
          toBlock: "latest",
        },
      ])) as unknown[];
      return liquidationHistorySignal(Array.isArray(logs) ? logs.length : 0);
    }),

    safely("funding_concentration", async () => {
      if (!config.explorerApi) return fundingConcentrationSignal({ siblingWalletsFromSameFunder: 0 });

      // Find who funded this wallet, then how many other wallets they funded.
      const inbound = await fetch(
        `${config.explorerApi}?module=account&action=txlist&address=${addr}&sort=asc&page=1&offset=5`,
        { signal: AbortSignal.timeout(9000) }
      );
      const inJson = (await inbound.json()) as {
        result?: Array<{ from?: string; to?: string }>;
      };
      const funder = inJson.result?.find((t) => t.to?.toLowerCase() === addr)?.from;
      if (!funder) return fundingConcentrationSignal({ siblingWalletsFromSameFunder: 0 });

      const out = await fetch(
        `${config.explorerApi}?module=account&action=txlist&address=${funder}&sort=desc&page=1&offset=100`,
        { signal: AbortSignal.timeout(9000) }
      );
      const outJson = (await out.json()) as { result?: Array<{ to?: string }> };
      const rows = outJson.result ?? [];
      const distinct = new Set(
        rows
          .map((t) => t.to?.toLowerCase())
          .filter((t): t is string => Boolean(t) && t !== funder.toLowerCase())
      );

      // A funder whose recent history is almost entirely distinct recipients is
      // a faucet or an exchange, not a farm. We fetched 100 rows, so hitting the
      // page limit is itself the signal that this is high-volume infrastructure.
      const funderIsInfrastructure = rows.length >= 100;

      return fundingConcentrationSignal({
        siblingWalletsFromSameFunder: distinct.size,
        funderIsInfrastructure,
      });
    }),
  ]);

  return scoreFromSignals(address, signals);
}
