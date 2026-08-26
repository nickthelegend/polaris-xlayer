# @polarispay/mcp

**Credit for agents.**

An agent can hold a wallet and spend from it, but it cannot get credit. Every
machine-to-machine purchase today is prepay: an agent that runs out of balance
mid-task simply stops. This exposes PolarisPay's credit line as MCP tools, so an
agent gets the same primitives a human gets at checkout — check what it can
afford, pay now, pay later, subscribe, or raise its own limit.

```bash
npx polaris-mcp
```

Reads work with no credentials. Set `KEEPERHUB_API_KEY` to enable the tools that
spend.

## Tools

| Tool | What it does |
|---|---|
| `polaris_get_credit` | Score, limit, drawn, available, collateral — read from chain |
| `polaris_can_afford` | Yes/no for an amount, plus the shortfall and the collateral that would close it |
| `polaris_pay_now` | Pay a merchant in full; the same `orderId` can never be charged twice |
| `polaris_pay_later` | Split into instalments, collected automatically without the agent online |
| `polaris_subscribe` | Recurring plan; first period charged immediately |
| `polaris_cancel_subscription` | Unilateral, no merchant approval needed |
| `polaris_lock_collateral` | Raise the limit immediately — 1.5 units of credit per unit locked |

Reads are marked `readOnlyHint`, spends `destructiveHint`, so an agent can tell
them apart before calling.

## Why the writes are safe to hand to an agent

Every write goes through KeeperHub rather than signing directly:

- **Simulated first.** An agent is told it cannot afford something before it
  spends gas discovering the same thing.
- **Per-attempt idempotency keys.** A retrying agent cannot double-charge, and a
  genuine retry is not served a cached failure.
- **Reconciled to a terminal status.** "Did it land?" always has an answer.
- **Inside the organisation's spending cap.** A runaway agent cannot exceed it
  regardless of what it decides.

## Verified on live Sepolia

An agent checked its credit, paid a merchant, locked collateral and watched its
own limit rise — using only these tools:

```
1. checks credit       score 600 · limit 500.00 · available 500.00
2. can afford 12.00?   true
3. pays merchant       12.00 · gasSponsored=true
4. raises its limit    locked 100.00 → +150.00 credit
5. re-checks credit    limit 500.00 → 650.00
```

[Payment](https://sepolia.etherscan.io/tx/0x3bdde827c28f1cdd9be8ad4ec6dd8787e5527e4daf8ca5698037143dbb78fe31) ·
[Collateral](https://sepolia.etherscan.io/tx/0x3431744b66d5b60494aef9c975dcdb26790892518fd36931b4d5ec7b3c4aedd7)

Both gas-sponsored: the agent paid no ETH.

## A note on sponsored execution

The address that spends is the **EIP-7702 smart account**, not the relayer EOA
that broadcasts. Funding the EOA does nothing — the balance and allowances must
sit on the smart account. This caught us during testing, and it is the same
reason the client never infers success from EOA state.
