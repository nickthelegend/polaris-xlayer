# KeeperHub surface map

Which KeeperHub surfaces PolarisPay uses, where, and whether the product would work without them. Listed honestly — a surface that is merely available is not claimed as used.

## Load-bearing

The product does not function without these.

### Schedule triggers
The billing clock. Every installment fires from KeeperHub's scheduler, not from a PolarisPay server. If our infrastructure is down on the first of the month, collections still run.

→ `keeper/workflows/installment-collection.json`

### Direct execution — `execute_contract_call`
Every charge, liquidation and settlement. `LoanEngine.repay`, `LoanEngine.liquidate`, `PolarisMerchantEscrow.settlePayment`.

→ `packages/keeperhub/src/client.ts` · `executeContractCall`

### `check-and-execute`
Liquidation. Reads `checkLiquidatable(loanId)`, compares it to `true`, and calls `liquidate(loanId)` in the same atomic step. A separate read-then-write would race every other keeper on the protocol and risk liquidating a loan repaid in the gap.

→ `packages/keeperhub/src/polaris.ts` · `liquidateIfUnhealthy`

### `simulate`
Every write is dry-run first. Returns the gas the network would charge and the decoded revert reason without signing or broadcasting. This is what turns "borrower is short" from a burnt transaction into a free signal that feeds the dunning ladder.

`simulate` must be a real boolean — KeeperHub rejects the string `"true"` rather than coercing it, so a mistyped flag can never fall through to a live broadcast.

→ `packages/keeperhub/src/client.ts` · `assertWouldSucceed`

### Idempotency keys
The only thing standing between a retry storm and a double-charged customer. Scoped per attempt (`${actionId}-a${attempt}`) rather than per action — see the note below.

### Execution status reconciliation
`GET /api/execute/{executionId}/status`. The execute response carries no transaction hash, so this is the only way to learn one. For a sponsored execution it is the *only* signal at all.

→ `packages/keeperhub/src/client.ts` · `waitForTerminal`

### Audit trail
KeeperHub logs trigger, simulation result, transaction hash, gas used, outcome and timestamp for every direct execution. PolarisPay projects that into `Receipt`, joined to the loan and installment, so a charge is disputable evidence.

→ `packages/keeperhub/src/receipts.ts`

## Real but secondary

- **Retries + adaptive gas + RPC failover** — matters on the first of the month when hundreds of installments fire at once. Free, and we do not reimplement it.
- **Gas sponsorship** — Ethereum, Base, Polygon, Arbitrum and their testnets, including Sepolia (11155111) where PolarisPay runs. The keeper wallet never needs a native balance.
- **Spending caps** — organization-level hard ceiling, so a bug cannot drain the treasury.
- **Notification plugins** — Telegram and Discord for dunning notices and liquidation alerts.
- **Block triggers** — health-factor sweeps for liquidation candidates.

## Not claimed

x402, MPP/Tempo, the workflow marketplace and MCP are all wired into KeeperHub and all plausible extensions of this product — agent-initiated checkout, netted merchant payouts on Tempo, listing the collection workflow for other credit protocols. None of them are load-bearing here, so they are not counted as used.

## Two behaviours that shaped the design

### Sponsored executions are invisible to the wallet

The Gas Station runs sponsored sends through a smart account. The keeper wallet's **nonce, native balance and explorer transaction list never change.** Verifying a charge by checking the wallet reports every success as a failure.

`waitForTerminal` is therefore not optional bookkeeping — it is the only source of truth. The client has no code path that infers success from wallet state.

### Idempotency caches failures, not just successes

A key's response is cached and replayed for 24 hours, **including failures**. That is exactly right for preventing a double-charge and exactly wrong for recovering from a transient one: a retry with the same key returns the original error while the chain has moved on.

So keys carry the attempt number. Transport-level duplicates of a single attempt still collapse — the case we actually need protection from — while a genuine retry gets a fresh execution. Protection against double-repayment across attempts belongs in the contract, and `LoanEngine` already tracks repaid amounts per loan.

### Argument encoding

The execute routes want every scalar as a string and `functionArgs` as a *stringified* JSON array. A numeric `chainId` or a real array is rejected. All encoding is centralised in `toContractCallBody` and `encodeArgs` so no caller has to remember it, and both are covered by tests.

## Reference

- [KeeperHub docs](https://docs.keeperhub.com/)
- [MCP server](https://docs.keeperhub.com/ai-tools/mcp-server)
- [Gas sponsorship](https://docs.keeperhub.com/wallet-management/gas) — including the constraints under which a transaction is *not* sponsored
