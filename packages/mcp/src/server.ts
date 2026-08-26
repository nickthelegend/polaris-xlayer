/**
 * PolarisPay MCP server — credit for agents.
 *
 * Agents can hold a wallet and spend from it, but they cannot get credit. Every
 * machine-to-machine purchase today is prepay: an agent that runs out of
 * balance mid-task simply stops. This exposes PolarisPay's credit line as MCP
 * tools, so an agent can check what it can afford, buy now and pay later, or
 * subscribe to a service — the same primitives a human gets at checkout.
 *
 * Reads run against the chain directly and need no credentials. Writes go
 * through KeeperHub, which is what makes them safe to hand to an autonomous
 * caller: every write simulates first, carries a per-attempt idempotency key,
 * reconciles to a terminal status, and lands inside the organisation's spending
 * cap. An agent cannot spend more than the cap regardless of what it decides.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { KeeperHubClient, encodeArgs, chargeKey } from "@polarispay/keeperhub";

const DEFAULT_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

export type PolarisMcpConfig = {
  chainId: number;
  rpcUrl?: string;
  contracts: {
    loanEngine: string;
    scoreManager: string;
    collateralVault: string;
    payments: string;
    stablecoin: string;
  };
  /** Required for the write tools. Reads work without it. */
  keeperHubApiKey?: string;
  keeperHubBaseUrl?: string;
  explorer?: string;
};

// keccak-derived, checked against the deployed ABIs.
const SEL = {
  scoreOf: "0x133af456",
  creditLimitOf: "0x4a9a75aa",
  baseLimitOf: "0x86254486",
  activeDebtOf: "0xb8603a21",
  lockedOf: "0xa5f1e282",
  creditBoostOf: "0xe8a7fec7",
} as const;

const PAYMENTS_ABI = JSON.stringify([
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "orderId", type: "string" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "subscribe",
    stateMutability: "nonpayable",
    inputs: [{ name: "planId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "cancel",
    stateMutability: "nonpayable",
    inputs: [{ name: "subId", type: "uint256" }],
    outputs: [],
  },
]);

const VAULT_ABI = JSON.stringify([
  {
    type: "function",
    name: "lock",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
]);

const u6 = (human: string): string => {
  const [whole, frac = ""] = human.split(".");
  return `${whole}${frac.padEnd(6, "0").slice(0, 6)}`.replace(/^0+(?=\d)/, "");
};
const fmt6 = (raw: bigint): string => {
  const w = raw / 1_000_000n;
  return `${w}.${(raw % 1_000_000n).toString().padStart(6, "0").slice(0, 2)}`;
};

export function createPolarisMcpServer(config: PolarisMcpConfig): McpServer {
  const rpc = config.rpcUrl ?? DEFAULT_RPC;
  const explorer = config.explorer ?? "https://sepolia.etherscan.io";
  const server = new McpServer({ name: "polarispay", version: "0.1.0" });

  const kh = config.keeperHubApiKey
    ? new KeeperHubClient({
        apiKey: config.keeperHubApiKey,
        baseUrl: config.keeperHubBaseUrl,
      })
    : undefined;

  async function ethCall(to: string, data: string): Promise<bigint> {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { result?: string; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    return json.result && json.result !== "0x" ? BigInt(json.result) : 0n;
  }

  const text = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  });
  const fail = (message: string) => ({
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  });

  function requireWrites(): KeeperHubClient | { error: string } {
    if (!kh) {
      return {
        error:
          "Write tools need a KeeperHub API key. Reads work without one; set KEEPERHUB_API_KEY to enable spending.",
      };
    }
    return kh;
  }

  // -------------------------------------------------------------------
  // Reads — no credentials, safe to call before committing to anything
  // -------------------------------------------------------------------

  server.tool(
    "polaris_get_credit",
    "Check an address's Polaris credit: score, total limit, how much is already drawn, and what is still available to spend. Call this before attempting a purchase on credit.",
    {
      address: z.string().describe("Wallet address to look up (0x...)"),
    },
    { title: "Get Credit Line", readOnlyHint: true },
    async ({ address }) => {
      try {
        const arg = address.replace("0x", "").toLowerCase().padStart(64, "0");
        const [score, limit, base, debt, locked, boost] = await Promise.all([
          ethCall(config.contracts.scoreManager, SEL.scoreOf + arg),
          ethCall(config.contracts.scoreManager, SEL.creditLimitOf + arg),
          ethCall(config.contracts.scoreManager, SEL.baseLimitOf + arg),
          ethCall(config.contracts.loanEngine, SEL.activeDebtOf + arg),
          ethCall(config.contracts.collateralVault, SEL.lockedOf + arg),
          ethCall(config.contracts.collateralVault, SEL.creditBoostOf + arg),
        ]);

        return text({
          address,
          creditScore: Number(score),
          totalLimit: fmt6(limit),
          scoreDerivedLimit: fmt6(base),
          collateralBoost: fmt6(boost),
          collateralLocked: fmt6(locked),
          drawn: fmt6(debt),
          available: fmt6(limit > debt ? limit - debt : 0n),
          chainId: config.chainId,
          // Stated plainly so an agent can decide rather than guess.
          howToRaiseIt:
            "Lock collateral for an immediate increase, or repay instalments on time to raise the score-derived limit.",
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    }
  );

  server.tool(
    "polaris_can_afford",
    "Ask whether an address can put a specific amount on credit right now. Returns a plain yes/no plus the shortfall if any, so an agent can decide between paying now, borrowing, or locking collateral first.",
    {
      address: z.string().describe("Wallet address (0x...)"),
      amount: z.string().describe("Amount in human units, e.g. '200.00'"),
    },
    { title: "Can Afford", readOnlyHint: true },
    async ({ address, amount }) => {
      try {
        const arg = address.replace("0x", "").toLowerCase().padStart(64, "0");
        const [limit, debt] = await Promise.all([
          ethCall(config.contracts.scoreManager, SEL.creditLimitOf + arg),
          ethCall(config.contracts.loanEngine, SEL.activeDebtOf + arg),
        ]);
        const available = limit > debt ? limit - debt : 0n;
        const want = BigInt(u6(amount));

        return text({
          affordable: available >= want,
          requested: amount,
          available: fmt6(available),
          shortfall: available >= want ? "0.00" : fmt6(want - available),
          // 150% multiplier, so the collateral needed is two thirds of the gap.
          collateralNeededToCover:
            available >= want ? "0.00" : fmt6(((want - available) * 2n) / 3n + 1n),
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    }
  );

  // -------------------------------------------------------------------
  // Writes — through KeeperHub, so they simulate, dedupe and reconcile
  // -------------------------------------------------------------------

  server.tool(
    "polaris_pay_now",
    "Pay a merchant in full, immediately, in stablecoin. Use when the agent has the balance and wants no ongoing obligation. The same orderId can never be charged twice.",
    {
      merchant: z.string().describe("Merchant payout address (0x...)"),
      amount: z.string().describe("Amount in human units, e.g. '25.00'"),
      order_id: z.string().describe("Your order reference. Charging it twice is refused."),
      idempotency_attempt: z
        .number()
        .optional()
        .describe("Attempt number. Increment on a genuine retry so a cached failure is not replayed."),
    },
    { title: "Pay Now", readOnlyHint: false, destructiveHint: true },
    async ({ merchant, amount, order_id, idempotency_attempt }) => {
      const client = requireWrites();
      if ("error" in client) return fail(client.error);

      try {
        const call = {
          contractAddress: config.contracts.payments,
          chainId: config.chainId,
          functionName: "pay",
          functionArgs: encodeArgs([merchant, u6(amount), order_id]),
          abi: PAYMENTS_ABI,
        };
        // Simulate first: an agent should be told it cannot afford this before
        // it spends gas discovering the same thing.
        await client.assertWouldSucceed(call);

        const status = await client.executeAndConfirm(call, {
          idempotencyKey: chargeKey(`pay-${merchant}-${order_id}`, idempotency_attempt ?? 1),
        });

        return text({
          paid: true,
          amount,
          merchant,
          orderId: order_id,
          transactionHash: status.transactionHash,
          explorerUrl: status.transactionHash ? `${explorer}/tx/${status.transactionHash}` : undefined,
          gasSponsored: status.sponsored ?? false,
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    }
  );

  server.tool(
    "polaris_pay_later",
    "Buy now and pay in instalments against the agent's credit line. Nothing is locked up front; instalments are collected automatically on schedule without the agent needing to be online. Check polaris_can_afford first.",
    {
      amount: z.string().describe("Total order amount in human units, e.g. '200.00'"),
      order_id: z.string().describe("Your order reference"),
      installments: z.number().optional().describe("Number of instalments, 1-24. Defaults to 4."),
      interval_seconds: z
        .number()
        .optional()
        .describe("Seconds between instalments. Defaults to 14 days."),
      endpoint: z
        .string()
        .optional()
        .describe("Merchant checkout endpoint that opens the plan. Defaults to /api/checkout."),
      api_key: z.string().optional().describe("Merchant API key for that endpoint."),
    },
    { title: "Pay Later", readOnlyHint: false, destructiveHint: true },
    async ({ amount, order_id, installments, interval_seconds, endpoint, api_key }) => {
      try {
        // Origination is originator-gated on chain, so it goes through the
        // merchant's backend rather than being something an agent can call
        // directly. That gate is the point: it is what stops an agent minting
        // its own credit.
        const res = await fetch(endpoint ?? "http://localhost:3111/api/checkout", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(api_key ? { "x-api-key": api_key } : {}),
          },
          body: JSON.stringify({
            amount,
            orderId: order_id,
            installments: installments ?? 4,
            intervalSeconds: interval_seconds ?? 14 * 86_400,
            chainId: config.chainId,
          }),
        });
        const body = (await res.json()) as Record<string, unknown>;
        if (!res.ok) return fail(String(body.error ?? `Checkout failed (${res.status})`));

        return text({
          planOpened: true,
          loanId: body.loanId,
          instalments: installments ?? 4,
          transactionHash: body.transactionHash,
          explorerUrl: body.transactionLink,
          note: "Instalments are collected automatically. No further action is needed unless the balance runs short.",
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    }
  );

  server.tool(
    "polaris_subscribe",
    "Subscribe to a merchant plan. The first period is charged immediately and later periods are collected automatically. The subscription can be cancelled at any time without the merchant's cooperation.",
    {
      plan_id: z.number().describe("Plan id to subscribe to"),
      idempotency_attempt: z.number().optional(),
    },
    { title: "Subscribe", readOnlyHint: false, destructiveHint: true },
    async ({ plan_id, idempotency_attempt }) => {
      const client = requireWrites();
      if ("error" in client) return fail(client.error);

      try {
        const call = {
          contractAddress: config.contracts.payments,
          chainId: config.chainId,
          functionName: "subscribe",
          functionArgs: encodeArgs([String(plan_id)]),
          abi: PAYMENTS_ABI,
        };
        await client.assertWouldSucceed(call);
        const status = await client.executeAndConfirm(call, {
          idempotencyKey: chargeKey(`sub-${plan_id}`, idempotency_attempt ?? 1),
        });

        return text({
          subscribed: true,
          planId: plan_id,
          transactionHash: status.transactionHash,
          explorerUrl: status.transactionHash ? `${explorer}/tx/${status.transactionHash}` : undefined,
          cancelWith: "polaris_cancel_subscription",
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    }
  );

  server.tool(
    "polaris_cancel_subscription",
    "Cancel a subscription. Takes effect immediately and needs no merchant approval — collection stops on the next cycle.",
    {
      subscription_id: z.number().describe("Subscription id to cancel"),
      idempotency_attempt: z.number().optional(),
    },
    { title: "Cancel Subscription", readOnlyHint: false, destructiveHint: true },
    async ({ subscription_id, idempotency_attempt }) => {
      const client = requireWrites();
      if ("error" in client) return fail(client.error);

      try {
        const status = await client.executeAndConfirm(
          {
            contractAddress: config.contracts.payments,
            chainId: config.chainId,
            functionName: "cancel",
            functionArgs: encodeArgs([String(subscription_id)]),
            abi: PAYMENTS_ABI,
          },
          { idempotencyKey: chargeKey(`cancel-${subscription_id}`, idempotency_attempt ?? 1) }
        );
        return text({
          cancelled: true,
          subscriptionId: subscription_id,
          transactionHash: status.transactionHash,
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    }
  );

  server.tool(
    "polaris_lock_collateral",
    "Lock stablecoin as collateral to raise the credit limit immediately. Each unit locked adds 1.5 units of limit. Collateral cannot be withdrawn while a loan is outstanding.",
    {
      amount: z.string().describe("Amount to lock in human units, e.g. '300.00'"),
      idempotency_attempt: z.number().optional(),
    },
    { title: "Lock Collateral", readOnlyHint: false, destructiveHint: true },
    async ({ amount, idempotency_attempt }) => {
      const client = requireWrites();
      if ("error" in client) return fail(client.error);

      try {
        const call = {
          contractAddress: config.contracts.collateralVault,
          chainId: config.chainId,
          functionName: "lock",
          functionArgs: encodeArgs([u6(amount)]),
          abi: VAULT_ABI,
        };
        await client.assertWouldSucceed(call);
        const status = await client.executeAndConfirm(call, {
          idempotencyKey: chargeKey(`lock-${amount}`, idempotency_attempt ?? 1),
        });

        const raw = BigInt(u6(amount));
        return text({
          locked: amount,
          creditGained: fmt6((raw * 15_000n) / 10_000n),
          transactionHash: status.transactionHash,
          note: "Withdrawal is blocked while any loan is outstanding.",
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    }
  );

  return server;
}
