# @polarispay/keeperhub

The execution layer for PolarisPay credit. Everything that has to touch a chain — collecting an installment, liquidating a defaulted loan, paying a merchant — goes through here so that four properties hold in one place:

1. **Simulate before broadcast** — never spend gas to discover a revert
2. **Idempotent writes** — a retry storm must not double-charge
3. **Terminal reconciliation** — "did it land?" always has an answer
4. **An auditable receipt** — every charge is disputable evidence

## Install

```bash
pnpm add @polarispay/keeperhub
```

## Use

```ts
import {
  KeeperHubClient,
  PolarisKeeper,
  InMemoryReceiptStore,
  CHAIN,
} from "@polarispay/keeperhub";

const client = new KeeperHubClient({ apiKey: process.env.KEEPERHUB_API_KEY! });

const keeper = new PolarisKeeper(
  client,
  { chainId: CHAIN.sepolia, loanEngine: "0x…" },
  new InMemoryReceiptStore()
);

// Simulates, broadcasts, polls to terminal, returns a receipt.
// Never throws on a failed charge — the receipt carries the typed reason.
const receipt = await keeper.collectInstallment({
  loanId: "42",
  installment: 2,
  amountRaw: "50000000",
  amountDisplay: "50.00 USDC",
});
```

Liquidation, atomically:

```ts
// checkLiquidatable(loanId) == true → liquidate(loanId), in one KeeperHub call.
// A healthy loan returns outcome "skipped" and sends nothing.
const receipt = await keeper.liquidateIfUnhealthy({ loanId: "42" });
```

Deciding what to do with a failure:

```ts
import { nextDunningStep } from "@polarispay/keeperhub";

const decision = nextDunningStep({
  attemptsMade: 2,
  failureKind: "insufficient_funds",
  now: new Date(),
});
// → { action: "retry", at: <+24h>, stage: { label: "day-1", notify: true } }
```

## API

| Export | Purpose |
|---|---|
| `KeeperHubClient` | Transport: auth, retry/backoff, simulate, execute, status polling |
| `PolarisKeeper` | The three lifecycle operations bound to Polaris contracts |
| `nextDunningStep` | Failure → retry / escalate / abandon |
| `Receipt`, `ReceiptStore` | The audit projection |
| `KeeperHubError` | Typed failures: `auth`, `rate_limit`, `spend_cap`, `would_revert`, `insufficient_funds`, `timeout`, `reverted`, … |
| `encodeArgs`, `chargeKey` | Route-correct argument encoding and per-attempt idempotency keys |

## Notes

**`assertWouldSucceed` classifies the revert.** An insufficient-balance revert becomes `insufficient_funds`, which the dunning ladder treats differently from a generic `would_revert` — one waits, the other is abandoned for reconciliation.

**Errors carry `retryable`.** `would_revert` and `insufficient_funds` are deliberately not retryable at the transport layer: the chain state that caused them has to change first, and that is a business schedule, not a network one.

**Sponsored executions never move the keeper wallet.** Confirm through `waitForTerminal`, never by inspecting nonce or balance.

## Tests

```bash
pnpm test
```

19 tests, run against the built artifact. They cover argument encoding, idempotency scoping, that no broadcast occurs when simulation fails, terminal reconciliation including the sponsored flag, the atomic liquidation call, the dunning branch by failure kind, and retry classification (429 retried, 400 not, spend-cap 403 distinguished from auth 403).
