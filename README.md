# PolarisPay × KeeperHub

**A payments layer with credit built in — and KeeperHub as the execution layer underneath it.**

Three ways to pay: in full, on a subscription, or split into instalments against an undercollateralized credit line. Polaris decides who gets credit; KeeperHub makes sure the money actually moves — instalments collected on the day they fall due, defaulted loans liquidated the moment they qualify, merchants paid. Every one is a transaction that has to land, exactly once, or somebody loses money.

Submission for the **KeeperHub Agents Onchain** hackathon.

**Live on Ethereum Sepolia, executing through KeeperHub.**

The keeper collects real instalments through KeeperHub's direct-execution API — simulate, sponsored broadcast, terminal reconciliation, receipt. Three collections in one pass, **every one gas-sponsored** so the keeper wallet paid nothing, and loan #1 retired at 4/4 with zero outstanding.

| | |
|---|---|
| Collection through KeeperHub | [`0x38e2126e…`](https://sepolia.etherscan.io/tx/0x38e2126efdff6ef5d0ab561abfd39592fd3081fcd365800c389ef1473000615b) — the instalment that closed loan #1 |
| Merchant settlement through KeeperHub | [`0x8218f391…`](https://sepolia.etherscan.io/tx/0x8218f39198a92985e781b8b881211779a45295f8de454954aae9eec318486d0f) |
| LoanEngine | [`0x21E9740D…`](https://sepolia.etherscan.io/address/0x21E9740DDe241f0653F699DAa206AfCE1FA25405) |
| CollateralVault | [`0xDb6781ed…`](https://sepolia.etherscan.io/address/0xDb6781ed843Ba07Af3321bB8C3952db643324b98) |
| PolarisPayments | [`0x3BD1609a…`](https://sepolia.etherscan.io/address/0x3BD1609abDC915eA9e01A399a26e2B8A2a06243f) |

Full transaction list, addresses and the one remaining gap: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## The problem

Credit is easy to issue and hard to collect.

A BNPL provider's real operational risk is not the lending decision — it is the four hundred installments due on the first of the month, the borrower whose balance moved between approval and collection, the gas spike that leaves a repayment unmined for three hours, and the defaulted loan that has to be liquidated before the position rots.

Every one of those is an execution problem. Not a credit problem.

**The question that kills a credit book is "did installment 3 collect?"** — and that is precisely the question KeeperHub exists to make always answerable.

## What runs through KeeperHub

| Lifecycle event | KeeperHub primitive | Why it has to be this way |
|---|---|---|
| Installment due | Schedule trigger → `simulate` → `execute_contract_call` on `LoanEngine.repay` | Dry-run first: a borrower who is short becomes a dunning event, not a burnt transaction |
| Loan unhealthy | `check-and-execute` on `checkLiquidatable` → `liquidate` | Read and write in **one atomic call** — no window for a last-second repayment to be liquidated on a stale read |
| Charge failed | Typed failure → dunning ladder | Retrying an insufficient-funds revert on a network schedule is worse than useless |
| Subscription due | Schedule trigger → `PolarisPayments.chargeDue` | Permissionless, so collection is not ours to monopolise |
| Merchant payable | Settlement queue → `execute_contract_call` | Derived from collected-but-unsettled instalments, not a hardcoded list |
| Any charge | `Idempotency-Key`, scoped per attempt | A retry storm must never double-charge a customer |
| Everything | Terminal status reconciliation + receipts | Disputable evidence for every movement of money |

`LoanEngine.checkLiquidatable(loanId) → liquidate(loanId)` maps **1:1** onto KeeperHub's `check-and-execute`. That is not a convenient coincidence — a conditional on-chain action is exactly what a keeper platform is for.

## Repository layout

```
packages/contracts    LoanEngine · ScoreManager · CollateralVault · PolarisPayments · MerchantRegistry
packages/keeperhub    the execution engine — simulate, idempotency, receipts
packages/db           MongoDB: loan book, receipts, settlements, webhooks
packages/sdk          createPolaris() — pay, subscribe, payLater in one call each
packages/mcp          the same operations, exposed to agents over MCP
keeper/               the runnable keeper: collect · subscriptions · liquidate · settle
apps/merchant         merchant portal, checkout API, collections ledger, demo store
apps/core             borrower app: credit line, plans, collateral
docs/                 architecture, deployment, surface map, roadmap
```

## Quick start

```bash
pnpm install
```

```bash
cp keeper/.env.example keeper/.env
```

Set `KEEPERHUB_API_KEY` (organization key from the KeeperHub dashboard, starts with `kh_`) and `POLARIS_LOAN_ENGINE`, then check your setup:

```bash
pnpm --filter @polarispay/keeper doctor
```

Run a pass without sending anything (`KEEPER_DRY_RUN=true`):

```bash
pnpm keeper:collect
```

The other jobs run the same way — `pnpm keeper:subscriptions` charges every
subscription period that is due, `pnpm keeper:liquidate` tests loans the book
has flagged, `pnpm keeper:settle` pays merchants.

Run the full loop:

```bash
pnpm keeper:all
```

## Three details worth knowing

**A sponsored execution is invisible to the wallet.** KeeperHub's Gas Station runs sponsored sends through a smart account, so the keeper wallet's nonce, native balance and explorer transaction list never change. Verifying a charge by checking the wallet reports every success as a failure. The execution status route is the only source of truth — the client enforces this.

**Idempotency keys are scoped per attempt, not per action.** KeeperHub caches responses for a key *including failures* and replays them for 24h. That protects against double-charging and actively prevents recovery: a retry with the same key returns the original error while the chain has moved on. Keys are `${actionId}-a${attempt}`, so transport duplicates still collapse while a genuine retry gets a fresh execution. Double-repayment is guarded where it belongs — in `LoanEngine`.

**Failures branch on cause, not on count.** `insufficient_funds` waits on a business ladder measured in days. `would_revert` is abandoned, because protocol state will not fix itself. `auth` and `spend_cap` are operator problems and never notify the borrower. This is in [`dunning.ts`](packages/keeperhub/src/dunning.ts).

## Tests

```bash
pnpm test
```

**107 tests** — 60 Solidity, 27 engine, 13 security, 7 live against the real KeeperHub API. They cover the paths where a bug costs real money, and every exploit an audit reproduced now has a regression test: dust repayments buying liquidation immunity, self-liquidation writing off debt for free, a protocol fee charged out of principal, simulate-gating, idempotency scoping, terminal reconciliation, and the dunning branch.

## Agents get credit, not just a wallet

An agent can hold a wallet and spend from it, but it cannot get credit — every
machine-to-machine purchase today is prepay, and an agent that runs out
mid-task simply stops. `@polarispay/mcp` exposes the credit line as MCP tools,
so an agent gets what a human gets at checkout.

Verified on live Sepolia, using only those tools:

```
1. checks credit       score 600 · limit 500.00 · available 500.00
2. can afford 12.00?   true
3. pays merchant       12.00 · gasSponsored=true
4. raises its limit    locked 100.00 → +150.00 credit
5. re-checks credit    limit 500.00 → 650.00
```

Both writes gas-sponsored — the agent paid no ETH. Every write simulates first,
carries a per-attempt idempotency key, reconciles to a terminal status, and
lands inside the organisation's spending cap, so a runaway agent cannot exceed
it. See [packages/mcp](packages/mcp/README.md).

## The three payment modes

```ts
const polaris = createPolaris();

await polaris.pay({ merchant, amount: "25.00", orderId });   // in full
await polaris.subscribe({ planId: 1 });                      // recurring
await polaris.payLater({ amount: "200.00", orderId });       // 4 instalments
```

Decimals are read from the token. A subscription approves one year of periods,
not an unlimited allowance, and the subscriber can cancel unilaterally at any
time. See [packages/sdk](packages/sdk/README.md).

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [100-feature roadmap](docs/ROADMAP-100.md) — every entry mapped to the KeeperHub primitive that powers it
- [KeeperHub surface map](docs/KEEPERHUB.md)
- [Live deployment and transactions](docs/DEPLOYMENT.md)
- [Build state](docs/FEATURES.md)

## License

MIT
